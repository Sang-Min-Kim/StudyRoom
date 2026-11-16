import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Link2,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { MaterialItem, Role, StoredFileMeta } from '../types';
import { apiRequest, resolveApiUrl } from '../utils/api';
import { prepareFileForUpload } from '../utils/upload';
import {
  formatBytes,
  formatDateTime,
  getFileCategoryLabel,
  getPreviewKind,
} from '../utils/format';

interface MaterialsPanelProps {
  roomCode: string;
  role: Role;
  hostToken?: string;
  materials: MaterialItem[];
  onPreviewFile: (file: StoredFileMeta) => void;
}

export const MaterialsPanel: React.FC<MaterialsPanelProps> = ({
  roomCode,
  role,
  hostToken,
  materials,
  onPreviewFile,
}) => {
  const isInstructor = role === 'instructor';
  const [filter, setFilter] = useState<'all' | 'pinned' | 'note' | 'file'>('all');
  const [query, setQuery] = useState('');
  const [composerOpen, setComposerOpen] = useState(true);

  // Composer state
  const [composeType, setComposeType] = useState<'note' | 'file' | 'link'>('note');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [pinned, setPinned] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredMaterials = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...materials]
      .filter((item) => {
        if (filter === 'pinned' && !item.pinned) return false;
        if (filter === 'note' && item.type !== 'note' && item.type !== 'notice') return false;
        if (filter === 'file' && !item.file && item.type !== 'file') return false;
        if (!q) return true;
        return [item.title, item.content, item.file?.originalName || '', item.linkUrl || '']
          .join(' ')
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.createdAt - a.createdAt;
      });
  }, [materials, filter, query]);

  const handleFilePick = (file: File | null) => {
    if (!file) return;
    setSelectedFile(file);
    if (!title.trim()) {
      setTitle(file.name.replace(/\.[^/.]+$/, ''));
    }
    setError('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isInstructor || !hostToken) return;
    setError('');

    if (composeType === 'file' && !selectedFile) {
      setError('업로드할 파일을 선택해 주세요.');
      return;
    }
    if (composeType === 'note' && !content.trim() && !selectedFile) {
      setError('배포할 교안 내용을 입력해 주세요.');
      return;
    }
    if (composeType === 'link' && !linkUrl.trim()) {
      setError('공유할 웹 주소(URL)를 입력해 주세요.');
      return;
    }

    setSubmitting(true);
    setUploadProgress(selectedFile ? 0 : null);
    try {
      const formData = new FormData();
      formData.append('type', composeType);
      formData.append('title', title.trim());
      formData.append('content', content.trim());
      if (linkUrl.trim()) {
        const normalizedUrl = /^https?:\/\//i.test(linkUrl.trim())
          ? linkUrl.trim()
          : `https://${linkUrl.trim()}`;
        formData.append('linkUrl', normalizedUrl);
      }
      formData.append('pinned', String(pinned));

      if (selectedFile) {
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

      const res = await apiRequest(`/api/rooms/${roomCode}/materials`, {
        method: 'POST',
        headers: { 'x-host-token': hostToken },
        body: formData,
      });
      if (!res.ok) {
        setError(res.error || '자료 배포에 실패했습니다.');
        return;
      }

      setTitle('');
      setContent('');
      setLinkUrl('');
      setPinned(false);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  };

  const handleTogglePin = async (item: MaterialItem) => {
    if (!isInstructor || !hostToken) return;
    await fetch(resolveApiUrl(`/api/rooms/${roomCode}/materials/${item.id}`), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-host-token': hostToken,
      },
      body: JSON.stringify({ pinned: !item.pinned }),
    });
  };

  const handleDelete = async (id: string) => {
    if (!isInstructor || !hostToken) return;
    await fetch(resolveApiUrl(`/api/rooms/${roomCode}/materials/${id}`), {
      method: 'DELETE',
      headers: { 'x-host-token': hostToken },
    });
  };

  const startEdit = (item: MaterialItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditContent(item.content);
  };

  const saveEdit = async (id: string) => {
    if (!isInstructor || !hostToken) return;
    await fetch(resolveApiUrl(`/api/rooms/${roomCode}/materials/${id}`), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-host-token': hostToken,
      },
      body: JSON.stringify({
        title: editTitle.trim(),
        content: editContent.trim(),
      }),
    });
    setEditingId(null);
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev));
      }, 1800);
    });
  };

  const getCategoryLabel = (item: MaterialItem) => {
    if (item.file) {
      return getFileCategoryLabel(item.file.mimeType, item.file.originalName);
    }
    if (item.type === 'link') return '참고 링크';
    if (item.type === 'notice') return '공지';
    return '교안·내용';
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Instructor Composer */}
      {isInstructor && (
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-3.5 border-b border-slate-100">
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900">
                교안 및 강의 자료 배포
              </h2>
              <p className="text-xs text-slate-500 truncate">
                업로드 즉시 모든 수강생 화면에 실시간 반영
              </p>
            </div>
            <button
              type="button"
              onClick={() => setComposerOpen((v) => !v)}
              className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              {composerOpen ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  <span>접기</span>
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  <span>새 자료 올리기</span>
                </>
              )}
            </button>
          </div>

          {composerOpen && (
            <form onSubmit={handleCreate} className="p-4 sm:p-5 space-y-4">
              {/* Type Tabs */}
              <div className="grid grid-cols-3 sm:inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => {
                    setComposeType('note');
                    setError('');
                  }}
                  className={`inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                    composeType === 'note'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>교안·내용</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setComposeType('file');
                    setError('');
                  }}
                  className={`inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                    composeType === 'file'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>파일 업로드</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setComposeType('link');
                    setError('');
                  }}
                  className={`inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                    composeType === 'link'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  <span>링크 공유</span>
                </button>
              </div>

              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  composeType === 'file'
                    ? '자료 제목 (비워두면 파일명이 자동 입력됩니다)'
                    : composeType === 'link'
                    ? '링크 제목 (예: 실습용 공공데이터 포털)'
                    : '교안 또는 안내 제목 (예: 2교시 SQL 실습 가이드)'
                }
                maxLength={100}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />

              {composeType === 'link' && (
                <input
                  type="text"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://example.com/resource"
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                />
              )}

              {composeType === 'file' && (
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
                    handleFilePick(f);
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
                    onChange={(e) => handleFilePick(e.target.files?.[0] || null)}
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
                        변경
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Upload className="h-5 w-5 text-slate-400 mx-auto" />
                      <p className="text-sm font-medium text-slate-700">
                        탭하거나 파일을 이곳에 끌어다 놓으세요
                      </p>
                      <p className="text-xs text-slate-500">
                        PDF, PPTX, DOCX, ZIP, 이미지, 소스코드 (최대 50MB)
                      </p>
                    </div>
                  )}
                </div>
              )}

              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={composeType === 'note' ? 4 : 2}
                placeholder={
                  composeType === 'note'
                    ? '수강생에게 전달할 교안 내용, 실습 코드, 안내사항 등을 입력하세요...'
                    : '자료에 대한 간단한 설명이나 참고사항 (선택)'
                }
                className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 resize-y"
              />

              {submitting && uploadProgress !== null && (
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

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <label className="inline-flex min-h-[40px] items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={pinned}
                    onChange={(e) => setPinned(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span>목록 상단에 고정</span>
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 text-xs sm:text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
                >
                  <Plus className="h-4 w-4" />
                  <span>
                    {submitting
                      ? uploadProgress !== null
                        ? `업로드 중 (${uploadProgress}%)`
                        : '배포 중...'
                      : '수강생에게 즉시 배포'}
                  </span>
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">
          {[
            { id: 'all', label: `전체 (${materials.length})` },
            { id: 'pinned', label: '고정됨' },
            { id: 'note', label: '교안·메모' },
            { id: 'file', label: '파일' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id as typeof filter)}
              className={`min-h-[34px] rounded-md px-3 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                filter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="제목, 내용, 파일명 검색"
            className="h-10 sm:h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
          />
        </div>
      </div>

      {/* Material List */}
      {filteredMaterials.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-sm font-semibold text-slate-900">
            {materials.length === 0
              ? '아직 배포된 교안이나 자료가 없습니다.'
              : '검색 조건에 맞는 자료가 없습니다.'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {isInstructor
              ? '위 입력 영역에서 교안이나 파일을 올리면 수강생 화면에 바로 표시됩니다.'
              : '강사가 교안이나 실습 파일을 배포하면 이곳에 실시간으로 나타납니다.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {filteredMaterials.map((item) => {
            const isEditing = editingId === item.id;
            const canPreview = item.file
              ? Boolean(getPreviewKind(item.file.mimeType, item.file.originalName))
              : false;

            return (
              <article
                key={item.id}
                className={`p-4 sm:p-5 transition-colors ${
                  item.pinned ? 'bg-blue-50/35' : 'bg-white'
                }`}
              >
                {isEditing ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={4}
                      className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>취소</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEdit(item.id)}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>저장</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        {/* Unboxed Metadata Row (Zero-Pill Rule) */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 tabular-nums">
                          {item.pinned && (
                            <>
                              <span className="inline-flex items-center gap-1 font-semibold text-blue-700">
                                <Pin className="h-3 w-3" />
                                <span>상단 고정</span>
                              </span>
                              <span aria-hidden="true" className="text-slate-300">
                                ·
                              </span>
                            </>
                          )}
                          <span className="font-semibold text-slate-700">
                            {getCategoryLabel(item)}
                          </span>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span>{formatDateTime(item.createdAt)}</span>
                          {item.file && (
                            <>
                              <span aria-hidden="true" className="text-slate-300">
                                ·
                              </span>
                              <span>{formatBytes(item.file.size)}</span>
                            </>
                          )}
                        </div>

                        <h3 className="mt-1 text-base font-bold text-slate-900 break-words">
                          {item.title}
                        </h3>
                      </div>

                      {/* Instructor Controls */}
                      {isInstructor && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleTogglePin(item)}
                            title={item.pinned ? '고정 해제' : '상단 고정'}
                            aria-label={item.pinned ? '고정 해제' : '상단 고정'}
                            className={`inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border text-xs transition-colors ${
                              item.pinned
                                ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                            }`}
                          >
                            {item.pinned ? (
                              <PinOff className="h-3.5 w-3.5" />
                            ) : (
                              <Pin className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(item)}
                            title="내용 수정"
                            aria-label="내용 수정"
                            className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(item.id)}
                            title="자료 삭제"
                            aria-label="자료 삭제"
                            className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {item.content && (
                      <div className="mt-3 rounded-lg bg-slate-50/80 border border-slate-100 p-3.5">
                        <p className="text-sm leading-relaxed text-slate-800 whitespace-pre-wrap break-words">
                          {item.content}
                        </p>
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleCopyText(item.id, item.content)}
                            className="inline-flex min-h-[32px] items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
                          >
                            {copiedId === item.id ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                                <span className="text-emerald-700">복사됨</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                <span>내용 복사</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {item.linkUrl && (
                      <div className="mt-3">
                        <a
                          href={item.linkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 text-xs sm:text-sm font-medium text-blue-700 hover:bg-blue-50 hover:border-blue-200 break-all"
                        >
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate max-w-[260px] sm:max-w-md">
                            {item.linkUrl}
                          </span>
                        </a>
                      </div>
                    )}

                    {item.file && (
                      <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-xs sm:text-sm font-semibold text-slate-900">
                            {item.file.originalName}
                          </p>
                          <p className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                            {formatBytes(item.file.size)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {canPreview && (
                            <button
                              type="button"
                              onClick={() => onPreviewFile(item.file!)}
                              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>미리보기</span>
                            </button>
                          )}
                          <a
                            href={resolveApiUrl(item.file.url)}
                            download={item.file.originalName}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>다운로드</span>
                          </a>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
