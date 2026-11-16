import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Link2,
  Lock,
  Search,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import type { Role, StoredFileMeta, SubmissionItem, SubmissionStatus } from '../types';
import { apiRequest, resolveApiUrl } from '../utils/api';
import { formatBytes, formatDateTime, getPreviewKind } from '../utils/format';
import { prepareFileForUpload } from '../utils/upload';

interface SubmissionsPanelProps {
  roomCode: string;
  role: Role;
  clientId: string;
  userName: string;
  hostToken?: string;
  submissionsOpen: boolean;
  submissions: SubmissionItem[];
  onPreviewFile: (file: StoredFileMeta) => void;
}

export const SubmissionsPanel: React.FC<SubmissionsPanelProps> = ({
  roomCode,
  role,
  clientId,
  userName,
  hostToken,
  submissionsOpen,
  submissions,
  onPreviewFile,
}) => {
  const isInstructor = role === 'instructor';
  const [uploadBoxOpen, setUploadBoxOpen] = useState(true);
  const [submitMode, setSubmitMode] = useState<'file' | 'url'>('file');
  const [submitterName, setSubmitterName] = useState(userName);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [comment, setComment] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const visibleSubmissions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...submissions]
      .filter((item) => {
        if (!q) return true;
        return [
          item.studentName,
          item.file?.originalName || '',
          item.linkUrl || '',
          item.linkTitle || '',
          item.comment,
        ]
          .join(' ')
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [submissions, query]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (!submissionsOpen && !isInstructor) {
      setError('현재 과제 제출이 마감되었습니다.');
      return;
    }

    if (submitMode === 'file' && !selectedFile) {
      setError('제출할 파일을 선택해 주세요.');
      return;
    }
    if (submitMode === 'url' && !linkUrl.trim()) {
      setError('제출할 웹 주소(URL)를 입력해 주세요.');
      return;
    }

    const resolvedName = (isInstructor ? submitterName : userName).trim() || userName;

    setUploading(true);
    setUploadProgress(submitMode === 'file' && selectedFile ? 0 : null);
    try {
      const formData = new FormData();
      if (submitMode === 'file' && selectedFile) {
        const prepared = await prepareFileForUpload(roomCode, selectedFile, (pct) => {
          setUploadProgress(pct);
        });
        if (!prepared.ok) {
          setError(prepared.error);
          return;
        }
        if (prepared.payload.uploadId) {
          formData.append('uploadId', prepared.payload.uploadId);
        } else if (prepared.payload.directFile) {
          formData.append('file', prepared.payload.directFile);
        }
      }
      if (submitMode === 'url' && linkUrl.trim()) {
        formData.append('linkUrl', linkUrl.trim());
        if (linkTitle.trim()) {
          formData.append('linkTitle', linkTitle.trim());
        }
      }
      formData.append('studentId', clientId);
      formData.append('studentName', resolvedName);
      formData.append('comment', comment.trim());

      const headers: Record<string, string> = {};
      if (isInstructor && hostToken) {
        headers['x-host-token'] = hostToken;
      }

      const res = await apiRequest(`/api/rooms/${roomCode}/submissions`, {
        method: 'POST',
        headers,
        body: formData,
      });
      if (!res.ok) {
        setError(res.error || '제출물 등록에 실패했습니다.');
        return;
      }

      setSelectedFile(null);
      setLinkUrl('');
      setLinkTitle('');
      setComment('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setSuccessMsg(
        isInstructor
          ? '제출물이 목록에 등록되었습니다.'
          : '과제 제출물이 강사에게 실시간으로 전달되었습니다.'
      );
      setTimeout(() => setSuccessMsg(''), 3000);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleToggleSubmissionsOpen = async () => {
    if (!isInstructor || !hostToken) return;
    await fetch(resolveApiUrl(`/api/rooms/${roomCode}/settings`), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-host-token': hostToken,
      },
      body: JSON.stringify({ submissionsOpen: !submissionsOpen }),
    });
  };

  const handleToggleStatus = async (item: SubmissionItem) => {
    if (!isInstructor || !hostToken) return;
    const nextStatus: SubmissionStatus =
      item.status === 'reviewed' ? 'submitted' : 'reviewed';
    await fetch(resolveApiUrl(`/api/rooms/${roomCode}/submissions/${item.id}`), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-host-token': hostToken,
      },
      body: JSON.stringify({ status: nextStatus }),
    });
  };

  const handleDelete = async (id: string) => {
    const headers: Record<string, string> = {};
    if (isInstructor && hostToken) {
      headers['x-host-token'] = hostToken;
    }
    await fetch(
      resolveApiUrl(
        `/api/rooms/${roomCode}/submissions/${id}?studentId=${encodeURIComponent(clientId)}`
      ),
      {
        method: 'DELETE',
        headers,
      }
    );
  };

  const handleCopyUrl = (id: string, url: string) => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev));
      }, 1800);
    });
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Instructor Control Bar */}
      {isInstructor && (
        <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-slate-200 bg-white px-4 py-3.5 sm:px-5 sm:py-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900 tabular-nums">
              수강생 제출물 수합 ({submissions.length}건)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              수강생이 파일이나 URL을 제출하거나 아래에서 직접 제출물을 올릴 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <a
              href={`/?pin=${roomCode}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <ExternalLink className="h-3.5 w-3.5 text-slate-500" />
              <span>새 탭에서 수강생 입장</span>
            </a>
            <button
              type="button"
              onClick={handleToggleSubmissionsOpen}
              className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border px-3.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                submissionsOpen
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              {submissionsOpen ? (
                <>
                  <Unlock className="h-3.5 w-3.5" />
                  <span>제출 허용 중 (클릭 시 마감)</span>
                </>
              ) : (
                <>
                  <Lock className="h-3.5 w-3.5" />
                  <span>제출 마감됨 (클릭 시 재개)</span>
                </>
              )}
            </button>
          </div>
        </section>
      )}

      {/* Upload / URL Card */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900">
              {isInstructor ? '제출물 직접 업로드 (예시·테스트)' : '과제·실습 제출물 업로드'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {isInstructor
                ? '강사 화면에서도 과제 파일 또는 URL 링크를 직접 올려 제출 흐름을 테스트할 수 있습니다.'
                : '파일 또는 결과물 URL을 제출하면 강사에게만 실시간 전달되며 다른 수강생에게는 공개되지 않습니다.'}
            </p>
          </div>
          {isInstructor ? (
            <button
              type="button"
              onClick={() => setUploadBoxOpen((v) => !v)}
              className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              {uploadBoxOpen ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  <span>접기</span>
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  <span>제출하기</span>
                </>
              )}
            </button>
          ) : (
            <span
              className={`text-xs font-semibold whitespace-nowrap shrink-0 ${
                submissionsOpen ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {submissionsOpen ? '제출 가능' : '제출 마감'}
            </span>
          )}
        </div>

        {(isInstructor ? uploadBoxOpen : true) && (
          <div className="p-4 sm:p-5">
            {submissionsOpen || isInstructor ? (
              <form onSubmit={handleSubmit} className="space-y-3.5">
                {/* Mode Toggle: File vs URL */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="grid grid-cols-2 sm:inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setSubmitMode('file');
                        setError('');
                      }}
                      className={`inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-md px-3.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                        submitMode === 'file'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>파일 제출</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSubmitMode('url');
                        setError('');
                      }}
                      className={`inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-md px-3.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                        submitMode === 'url'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      <span>URL 링크 제출</span>
                    </button>
                  </div>

                  {isInstructor && (
                    <div className="w-full sm:w-56">
                      <label
                        htmlFor="submission-author-name"
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
                        제출자 표시 이름
                      </label>
                      <input
                        id="submission-author-name"
                        type="text"
                        value={submitterName}
                        onChange={(e) => setSubmitterName(e.target.value)}
                        placeholder="예: 김상민"
                        maxLength={40}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                  )}
                </div>

                {submitMode === 'file' ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragActive(false);
                      const f = e.dataTransfer.files?.[0] || null;
                      if (f) {
                        setSelectedFile(f);
                        setError('');
                      }
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`cursor-pointer rounded-xl border border-dashed p-5 text-center transition-colors ${
                      dragActive
                        ? 'border-blue-600 bg-blue-50/50'
                        : 'border-slate-300 bg-slate-50/60 hover:border-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setSelectedFile(f);
                        setError('');
                      }}
                    />
                    {selectedFile ? (
                      <div className="flex items-center justify-between gap-3 text-left">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {selectedFile.name}
                          </p>
                          <p className="text-xs text-slate-500 tabular-nums mt-0.5">
                            {formatBytes(selectedFile.size)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFile(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          className="inline-flex min-h-[36px] items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 shrink-0"
                        >
                          파일 변경
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <Upload className="h-5 w-5 text-slate-400" />
                        <p className="text-sm font-medium text-slate-700">
                          탭하거나 제출할 파일을 끌어다 놓으세요
                        </p>
                        <p className="text-xs text-slate-500">최대 50MB</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                    <div className="sm:col-span-7">
                      <label htmlFor="submission-url" className="sr-only">
                        제출할 URL 주소
                      </label>
                      <input
                        id="submission-url"
                        type="text"
                        inputMode="url"
                        value={linkUrl}
                        onChange={(e) => {
                          setLinkUrl(e.target.value);
                          setError('');
                        }}
                        placeholder="https://github.com/... 또는 구글 문서·노션·웹 주소"
                        maxLength={500}
                        className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                      />
                    </div>
                    <div className="sm:col-span-5">
                      <label htmlFor="submission-url-title" className="sr-only">
                        링크 제목
                      </label>
                      <input
                        id="submission-url-title"
                        type="text"
                        value={linkTitle}
                        onChange={(e) => setLinkTitle(e.target.value)}
                        placeholder="링크 제목 (선택, 예: 실습 결과 페이지)"
                        maxLength={100}
                        className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                      />
                    </div>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="제출 메모 (선택, 예: 2교시 실습 완료)"
                    maxLength={120}
                    className="h-11 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={uploading}
                    className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-5 text-xs sm:text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
                  >
                    {submitMode === 'url' ? (
                      <Link2 className="h-3.5 w-3.5" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {uploading
                        ? uploadProgress !== null
                          ? `업로드 중 (${uploadProgress}%)`
                          : '전송 중...'
                        : submitMode === 'url'
                        ? 'URL 제출하기'
                        : '제출물 업로드'}
                    </span>
                  </button>
                </div>

                {uploading && uploadProgress !== null && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-600 tabular-nums">
                      <span>파일 업로드 중...</span>
                      <span className="font-semibold text-blue-700">{uploadProgress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full bg-blue-600 transition-all duration-150"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {error && (
                  <p className="text-xs font-medium text-red-600" role="alert">
                    {error}
                  </p>
                )}
                {successMsg && (
                  <p className="text-xs font-medium text-emerald-700">{successMsg}</p>
                )}
              </form>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs font-medium text-amber-800">
                현재 강사가 과제 제출 접수를 일시 중단했습니다.
              </div>
            )}
          </div>
        )}
      </section>

      {/* List Header & Search */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-xs font-semibold text-slate-600 tabular-nums">
          {isInstructor
            ? `제출된 목록 (${visibleSubmissions.length}건)`
            : `내 제출 내역 (${submissions.length}건)`}
        </h3>
        {submissions.length > 0 && (
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={isInstructor ? '제출자·파일명·URL 검색' : '파일명·URL 검색'}
              className="h-10 sm:h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Submission List */}
      {visibleSubmissions.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-sm font-semibold text-slate-900">
            {submissions.length === 0
              ? isInstructor
                ? '아직 제출된 과제가 없습니다.'
                : '아직 제출한 항목이 없습니다.'
              : '검색 조건에 맞는 제출물이 없습니다.'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {isInstructor
              ? '수강생이 파일이나 URL을 올리면 이곳에 실시간 표시됩니다.'
              : '위 영역에서 파일을 업로드하거나 URL 링크를 제출해 보세요.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="divide-y divide-slate-100">
            {visibleSubmissions.map((item) => {
              const file = item.file;
              const canPreview = file
                ? Boolean(getPreviewKind(file.mimeType, file.originalName))
                : false;
              const isReviewed = item.status === 'reviewed';
              const primaryLabel =
                file?.originalName || item.linkTitle || item.linkUrl || '제출물';

              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:px-5 sm:flex-row sm:items-center sm:justify-between hover:bg-slate-50/70 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-bold text-slate-900">
                        {item.studentName}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className="truncate text-sm font-medium text-slate-800 max-w-full sm:max-w-md">
                        {primaryLabel}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 tabular-nums">
                      <span>{file ? formatBytes(file.size) : 'URL 링크'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDateTime(item.createdAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`inline-flex items-center gap-1 font-semibold ${
                          isReviewed ? 'text-emerald-700' : 'text-slate-600'
                        }`}
                      >
                        {isReviewed && <CheckCircle2 className="h-3.5 w-3.5" />}
                        <span>{isReviewed ? '강사 확인됨' : '제출 완료'}</span>
                      </span>
                    </div>

                    {item.linkUrl && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <a
                          href={item.linkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-mono text-blue-700 hover:underline truncate max-w-[260px] sm:max-w-md"
                        >
                          <Link2 className="h-3 w-3 shrink-0" />
                          <span className="truncate">{item.linkUrl}</span>
                        </a>
                      </div>
                    )}

                    {item.comment && (
                      <p className="mt-1.5 text-xs text-slate-600 break-words">
                        메모: {item.comment}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {file && canPreview && (
                      <button
                        type="button"
                        onClick={() => onPreviewFile(file)}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>미리보기</span>
                      </button>
                    )}
                    {file && (
                      <a
                        href={resolveApiUrl(file.url)}
                        download={file.originalName}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>다운로드</span>
                      </a>
                    )}
                    {item.linkUrl && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleCopyUrl(item.id, item.linkUrl!)}
                          className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                        >
                          {copiedId === item.id ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                              <span className="text-emerald-700">복사됨</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              <span>URL 복사</span>
                            </>
                          )}
                        </button>
                        <a
                          href={item.linkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>링크 열기</span>
                        </a>
                      </>
                    )}
                    {isInstructor && (
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(item)}
                        className={`inline-flex min-h-[38px] items-center gap-1 rounded-lg border px-3 text-xs font-semibold whitespace-nowrap ${
                          isReviewed
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>{isReviewed ? '확인 취소' : '확인 완료'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      aria-label="제출물 삭제"
                      className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
