import { useCallback, useEffect, useMemo, useState } from "react";

export type AttachmentItem = {
  id: number;
  original_name?: string;
  file_url?: string | null;
  file_type?: string;
  mime_type?: string;
};

type AttachmentListProps<T extends AttachmentItem> = {
  files?: T[];
  onDownload: (file: T) => void | Promise<void>;
  onDownloadAll?: () => void | Promise<void>;
};

function fileNameOf(file: AttachmentItem) {
  return file.original_name || `첨부파일 ${file.id}`;
}

function extensionOf(file: AttachmentItem) {
  const name = file.original_name || "";
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

function previewKindOf(file: AttachmentItem) {
  const mimeType = file.mime_type || "";
  const extension = extensionOf(file);
  if (file.file_type === "IMAGE" || mimeType.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "bmp", "webp"].includes(extension)) {
    return "image";
  }
  if (mimeType.startsWith("video/") || ["mp4", "mkv", "avi", "mov", "wmv", "webm"].includes(extension)) {
    return "video";
  }
  return null;
}

export function AttachmentList<T extends AttachmentItem>({ files, onDownload, onDownloadAll }: AttachmentListProps<T>) {
  const previewableFiles = useMemo(() => files?.filter((file) => file.file_url && previewKindOf(file)) ?? [], [files]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const previewFile = previewIndex === null ? null : previewableFiles[previewIndex] ?? null;
  const previewKind = previewFile ? previewKindOf(previewFile) : null;
  const canMovePreview = previewableFiles.length > 1;

  const closePreview = useCallback(() => {
    setPreviewIndex(null);
  }, []);

  const movePreview = useCallback((direction: -1 | 1) => {
    if (!previewableFiles.length) {
      return;
    }
    setPreviewIndex((current) => {
      const currentIndex = current ?? 0;
      return (currentIndex + direction + previewableFiles.length) % previewableFiles.length;
    });
  }, [previewableFiles.length]);

  function openPreview(file: T) {
    const index = previewableFiles.findIndex((entry) => entry.id === file.id);
    setPreviewIndex(index >= 0 ? index : null);
  }

  useEffect(() => {
    if (!previewFile) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closePreview();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        movePreview(-1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        movePreview(1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closePreview, movePreview, previewFile]);

  if (!files?.length) {
    return <p className="report-detail-empty">첨부파일이 없습니다.</p>;
  }

  return (
    <>
      <div className="attachment-list">
        {files.map((file) => {
          const canPreview = Boolean(file.file_url && previewKindOf(file));
          return (
            <div className="attachment-row" key={file.id}>
              <button className="text-button attachment-name-button" onClick={() => (canPreview ? openPreview(file) : onDownload(file))} type="button">
                {fileNameOf(file)}
              </button>
              {canPreview && (
                <button className="ghost-button attachment-action-button" onClick={() => onDownload(file)} type="button">
                  다운로드
                </button>
              )}
            </div>
          );
        })}
        {files.length > 1 && onDownloadAll && (
          <button className="ghost-button attachment-download-all" onClick={onDownloadAll} type="button">
            전체 다운로드
          </button>
        )}
      </div>

      {previewFile?.file_url && previewKind && (
        <div className="modal-backdrop nested-modal-backdrop">
          <div className="modal-panel attachment-preview-modal">
            <div className="panel-head">
              <h2>{fileNameOf(previewFile)}</h2>
              <div className="table-actions">
                <button className="ghost-button" onClick={() => onDownload(previewFile)} type="button">
                  다운로드
                </button>
                <button className="ghost-button" onClick={closePreview} type="button">
                  닫기
                </button>
              </div>
            </div>
            {canMovePreview && (
              <div className="attachment-preview-controls">
                <button className="ghost-button" onClick={() => movePreview(-1)} type="button">
                  이전
                </button>
                <span>{(previewIndex ?? 0) + 1} / {previewableFiles.length}</span>
                <button className="ghost-button" onClick={() => movePreview(1)} type="button">
                  다음
                </button>
              </div>
            )}
            {previewKind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={fileNameOf(previewFile)} className="attachment-preview-media" src={previewFile.file_url} />
            ) : (
              <video className="attachment-preview-media" controls src={previewFile.file_url}>
                미리보기를 지원하지 않는 브라우저입니다.
              </video>
            )}
          </div>
        </div>
      )}
    </>
  );
}
