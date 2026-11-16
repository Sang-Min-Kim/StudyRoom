import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileText,
  X,
} from 'lucide-react';
import type { StoredFileMeta } from '../types';
import { resolveApiUrl } from '../utils/api';
import { formatBytes, getPreviewKind } from '../utils/format';

interface FilePreviewModalProps {
  file: StoredFileMeta | null;
  onClose: () => void;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({ file, onClose }) => {
  const [textContent, setTextContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const kind = file ? getPreviewKind(file.mimeType, file.originalName) : null;

  useEffect(() => {
    if (!file || kind !== 'text') {
      setTextContent('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(resolveApiUrl(`${file.url}?inline=1`))
      .then((res) => res.text())
      .then((text) => {
        if (!cancelled) setTextContent(text);
      })
      .catch(() => {
        if (!cancelled) {
          setTextContent('파일 내용을 불러오지 못했습니다. 다운로드하여 확인해 주세요.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file, kind]);

  useEffect(() => {
    if (!file) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [file, onClose]);

  if (!file) return null;

  const handleCopyText = () => {
    if (!textContent) return;
    navigator.clipboard?.writeText(textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${file.originalName} 미리보기`}
    >
      <div
        className="flex max-h-[92dvh] sm:max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5 sm:py-3.5">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-900">
              {file.originalName}
            </h3>
            <p className="text-xs text-slate-500 tabular-nums mt-0.5">
              {formatBytes(file.size)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {kind === 'text' && textContent && (
              <button
                type="button"
                onClick={handleCopyText}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-emerald-700">복사됨</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-slate-400" />
                    <span className="hidden sm:inline">코드 복사</span>
                  </>
                )}
              </button>
            )}
            <a
              href={resolveApiUrl(file.url)}
              download={file.originalName}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 sm:px-4 text-xs font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              <span>다운로드</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="미리보기 닫기"
              className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-slate-50 p-3 sm:p-6 pb-safe">
          {kind === 'image' && (
            <div className="flex items-center justify-center">
              <img
                src={resolveApiUrl(`${file.url}?inline=1`)}
                alt={file.originalName}
                referrerPolicy="no-referrer"
                className="max-h-[70dvh] w-auto rounded-lg border border-slate-200 bg-white object-contain"
              />
            </div>
          )}

          {kind === 'pdf' && (
            <div className="space-y-3">
              <iframe
                src={resolveApiUrl(`${file.url}?inline=1`)}
                title={file.originalName}
                className="h-[65dvh] sm:h-[70vh] w-full rounded-lg border border-slate-200 bg-white"
              />
              <p className="text-center text-xs text-slate-500 sm:hidden">
                모바일 브라우저에서 PDF가 보이지 않을 경우 상단의 다운로드 버튼을 이용해 주세요.
              </p>
            </div>
          )}

          {kind === 'text' && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              {loading ? (
                <p className="text-sm text-slate-500">내용을 불러오는 중입니다...</p>
              ) : (
                <pre className="overflow-x-auto font-mono text-xs sm:text-sm leading-relaxed text-slate-800 whitespace-pre-wrap break-words">
                  {textContent}
                </pre>
              )}
            </div>
          )}

          {!kind && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-10 w-10 text-slate-300 mb-3" />
              <p className="text-sm text-slate-600">
                이 파일 형식은 브라우저에서 바로 미리보기를 지원하지 않습니다.
              </p>
              <a
                href={resolveApiUrl(file.url)}
                download={file.originalName}
                className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Download className="h-4 w-4" />
                <span>파일 다운로드하기</span>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
