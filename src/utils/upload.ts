import { apiRequest } from './api';

const CHUNK_THRESHOLD_BYTES = 1.5 * 1024 * 1024; // 1.5MB
const CHUNK_SIZE_BYTES = 1.5 * 1024 * 1024; // 1.5MB per chunk
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB

export interface PreparedFilePayload {
  directFile?: File;
  uploadId?: string;
}

export async function prepareFileForUpload(
  roomCode: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ ok: true; payload: PreparedFilePayload } | { ok: false; error: string }> {
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: '파일 크기는 최대 50MB까지 업로드할 수 있습니다.' };
  }

  if (file.size <= CHUNK_THRESHOLD_BYTES) {
    onProgress?.(100);
    return { ok: true, payload: { directFile: file } };
  }

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE_BYTES);
  onProgress?.(2);

  const initRes = await apiRequest<{ uploadId: string }>(
    `/api/rooms/${roomCode}/uploads/init`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        totalSize: file.size,
        totalChunks,
      }),
    },
    2
  );

  if (!initRes.ok || !initRes.data?.uploadId) {
    return {
      ok: false,
      error: initRes.error || '파일 업로드를 시작하지 못했습니다.',
    };
  }

  const uploadId = initRes.data.uploadId;

  for (let i = 0; i < totalChunks; i += 1) {
    const start = i * CHUNK_SIZE_BYTES;
    const end = Math.min(start + CHUNK_SIZE_BYTES, file.size);
    const blob = file.slice(start, end);

    const chunkForm = new FormData();
    chunkForm.append('chunkIndex', String(i));
    chunkForm.append('chunk', blob, `part_${i}`);

    const chunkRes = await apiRequest(
      `/api/rooms/${roomCode}/uploads/${uploadId}/chunk`,
      {
        method: 'POST',
        body: chunkForm,
      },
      2
    );

    if (!chunkRes.ok) {
      return {
        ok: false,
        error:
          chunkRes.error ||
          `파일 조각 전송(${i + 1}/${totalChunks}) 중 오류가 발생했습니다.`,
      };
    }

    const percent = Math.min(98, Math.round(((i + 1) / totalChunks) * 95) + 3);
    onProgress?.(percent);
  }

  onProgress?.(100);
  return { ok: true, payload: { uploadId } };
}
