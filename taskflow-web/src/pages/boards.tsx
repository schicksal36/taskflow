import { FormEvent, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { AttachmentList } from "@/components/AttachmentList";
import { useAuth } from "@/contexts/AuthContext";
import {
  type BoardComment,
  type BoardCommentFile,
  type BoardFile,
  type BoardPost,
  type BoardPostInput,
  type UserListItem,
  attachBoardCommentFile,
  attachBoardFile,
  createBoardComment,
  createBoardPost,
  deleteBoardComment,
  deleteBoardPost,
  describeApiError,
  downloadAllBoardFiles,
  downloadBoardCommentFile,
  downloadBoardFile,
  fetchBoardPost,
  fetchBoardComments,
  fetchBoardPosts,
  fetchUsers,
  toArray,
  updateBoardComment,
  updateBoardPost,
  uploadMediaFile,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { boardTypeLabels, labelOf } from "@/lib/labels";

const boardOptions = ["NOTICE"];

export const emptyForm: BoardPostInput = {
  board_type: "NOTICE",
  title: "",
  content: "",
  is_notice: true,
  is_pinned: false,
  permission: "PUBLIC",
  specific_user_ids: [],
};

type BoardsPageContentProps = {
  title?: string;
  description?: string;
  listTitle?: string;
  emptyMessage?: string;
  allowedTypes?: string[];
  fixedBoardType?: string;
  enableComments?: boolean;
  entityLabel?: string;
};

export function BoardsPageContent({
  title = "공지사항",
  description = "공지사항을 등록하고 전사 공유 내용을 관리합니다.",
  listTitle = "공지사항 목록",
  emptyMessage = "등록된 공지사항이 없습니다.",
  allowedTypes = boardOptions,
  fixedBoardType,
  enableComments = false,
  entityLabel,
}: BoardsPageContentProps) {
  const { accessToken, user } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "CEO" || user?.role === "SUPERUSER";
  const defaultForm = { ...emptyForm, board_type: fixedBoardType ?? emptyForm.board_type, is_notice: fixedBoardType === "NOTICE" || (!fixedBoardType && emptyForm.is_notice) };
  const [items, setItems] = useState<BoardPost[]>([]);
  const [form, setForm] = useState<BoardPostInput>(defaultForm);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [specificUserIds, setSpecificUserIds] = useState<number[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [detailTarget, setDetailTarget] = useState<BoardPost | null>(null);
  const [detailComments, setDetailComments] = useState<BoardComment[]>([]);
  const [commentInput, setCommentInput] = useState("");
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [commentPreviewUrls, setCommentPreviewUrls] = useState<string[]>([]);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<number[]>([]);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCommentSaving, setIsCommentSaving] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [boardTypeFilter, setBoardTypeFilter] = useState("");
  const resolvedEntityLabel = entityLabel ?? (fixedBoardType === "DATA_ROOM" ? "자료" : fixedBoardType === "FREE" ? "게시글" : "공지사항");

  async function loadItems() {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const targetTypes = boardTypeFilter ? [boardTypeFilter] : allowedTypes;
      const responses = await Promise.all(
        targetTypes.map((boardType) => fetchBoardPosts(accessToken, boardType, searchTerm)),
      );
      setItems(responses.flatMap((response) => toArray(response)));
      setSelectedDeleteIds([]);
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
    // loadItems는 저장/삭제 후에도 재사용하는 함수라 effect 의존성만 고정합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, searchTerm, boardTypeFilter]);

  useEffect(() => {
    async function loadUsers() {
      if (!accessToken) {
        return;
      }
      try {
        setUsers(toArray(await fetchUsers(accessToken)));
      } catch {
        setUsers([]);
      }
    }
    loadUsers();
  }, [accessToken]);

  useEffect(() => () => {
    commentPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [commentPreviewUrls]);

  function resetForm() {
    setEditingId(null);
    setForm(defaultForm);
    setSpecificUserIds([]);
    setFiles([]);
    setCommentFiles([]);
    setCommentPreviewUrls((current) => {
      current.forEach((url) => URL.revokeObjectURL(url));
      return [];
    });
    setUserSearch("");
    setIsEditorOpen(false);
  }

  function openCreateForm() {
    if (isEditorOpen) {
      resetForm();
      return;
    }
    setEditingId(null);
    setForm(defaultForm);
    setSpecificUserIds([]);
    setFiles([]);
    setUserSearch("");
    setIsEditorOpen(true);
  }

  function startEdit(item: BoardPost) {
    setEditingId(item.id);
    setIsEditorOpen(true);
    setForm({
      board_type: fixedBoardType ?? item.board_type,
      title: item.title,
      content: item.content ?? "",
      is_notice: Boolean(item.is_notice),
      is_pinned: Boolean(item.is_pinned),
      permission: item.permission ?? "PUBLIC",
      specific_user_ids: item.specific_user_ids ?? [],
    });
    setSpecificUserIds(item.specific_user_ids ?? []);
    setFiles([]);
    setUserSearch("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const payload = { ...form, specific_user_ids: specificUserIds };
      let saved: BoardPost;
      if (editingId) {
        saved = await updateBoardPost(accessToken, editingId, payload);
      } else {
        saved = await createBoardPost(accessToken, payload);
      }
      for (const file of files) {
        const media = await uploadMediaFile(accessToken, file, { target_app: "BOARDS", target_id: saved.id });
        await attachBoardFile(accessToken, saved.id, media.id);
      }
      resetForm();
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsSaving(false);
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchTerm(searchInput.trim());
  }

  function clearSearch() {
    setSearchInput("");
    setSearchTerm("");
    setBoardTypeFilter("");
  }

  async function handleDelete(id: number) {
    if (!accessToken) {
      return;
    }

    try {
      await deleteBoardPost(accessToken, id);
      setSelectedDeleteIds((current) => current.filter((value) => value !== id));
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleBulkDelete() {
    if (!accessToken || !selectedDeleteIds.length) {
      return;
    }

    try {
      await Promise.all(selectedDeleteIds.map((id) => deleteBoardPost(accessToken, id)));
      setSelectedDeleteIds([]);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function openDetail(item: BoardPost) {
    if (!accessToken) {
      return;
    }

    setMessage("");
    try {
      const [post, comments] = await Promise.all([
        fetchBoardPost(accessToken, item.id),
        enableComments ? fetchBoardComments(accessToken, item.id) : Promise.resolve([]),
      ]);
      setDetailTarget(post);
      setDetailComments(toArray(comments));
      setCommentInput("");
      setCommentFiles([]);
      setEditingCommentId(null);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function refreshDetail(postId: number) {
    if (!accessToken) {
      return;
    }
    const [post, comments] = await Promise.all([
      fetchBoardPost(accessToken, postId),
      enableComments ? fetchBoardComments(accessToken, postId) : Promise.resolve([]),
    ]);
    setDetailTarget(post);
    setDetailComments(toArray(comments));
  }

  async function handleSubmitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !detailTarget || !commentInput.trim()) {
      return;
    }

    setIsCommentSaving(true);
    setMessage("");
    try {
      const comment = editingCommentId
        ? await updateBoardComment(accessToken, editingCommentId, commentInput.trim())
        : await createBoardComment(accessToken, detailTarget.id, commentInput.trim());
      for (const file of commentFiles) {
        const media = await uploadMediaFile(accessToken, file, { target_app: "BOARD_COMMENTS", target_id: comment.id });
        await attachBoardCommentFile(accessToken, comment.id, media.id);
      }
      setCommentInput("");
      setCommentFiles([]);
      setCommentPreviewUrls((current) => {
        current.forEach((url) => URL.revokeObjectURL(url));
        return [];
      });
      setEditingCommentId(null);
      await refreshDetail(detailTarget.id);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsCommentSaving(false);
    }
  }

  async function handleDownloadFile(file: BoardFile) {
    if (!accessToken) {
      return;
    }
    try {
      await downloadBoardFile(accessToken, file.id, file.original_name);
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleDownloadCommentFile(file: BoardCommentFile) {
    if (!accessToken) {
      return;
    }
    try {
      await downloadBoardCommentFile(accessToken, file.id, file.original_name);
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  function handleCommentFiles(files: File[]) {
    setCommentPreviewUrls((current) => {
      current.forEach((url) => URL.revokeObjectURL(url));
      return files.map((file) => URL.createObjectURL(file));
    });
    setCommentFiles(files);
  }

  function startEditComment(comment: BoardComment) {
    setEditingCommentId(comment.id);
    setCommentInput(comment.content);
    setCommentFiles([]);
    setCommentPreviewUrls((current) => {
      current.forEach((url) => URL.revokeObjectURL(url));
      return [];
    });
  }

  async function handleDeleteComment(commentId: number) {
    if (!accessToken || !detailTarget) {
      return;
    }
    try {
      await deleteBoardComment(accessToken, commentId);
      await refreshDetail(detailTarget.id);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleDownloadAllFiles(item: BoardPost) {
    if (!accessToken) {
      return;
    }
    try {
      await downloadAllBoardFiles(accessToken, item.id);
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  function toggleSpecificUser(id: number) {
    setSpecificUserIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  const filteredUsers = users.filter((item) => {
    const keyword = userSearch.trim().toLowerCase();
    if (!keyword) {
      return true;
    }
    return [item.display_name, item.email, item.department].filter(Boolean).some((value) => String(value).toLowerCase().includes(keyword));
  });
  const canFilterBoardType = !fixedBoardType && allowedTypes.length > 1;
  const canDeletePost = (item: BoardPost) => isAdmin || item.author === user?.id;
  const canEditPost = (item: BoardPost) => isAdmin || item.author === user?.id;
  const deletableItems = items.filter(canDeletePost);
  const allDeletableSelected = deletableItems.length > 0 && deletableItems.every((item) => selectedDeleteIds.includes(item.id));

  function toggleDeleteSelection(id: number) {
    setSelectedDeleteIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  function toggleAllDeleteSelection() {
    setSelectedDeleteIds(allDeletableSelected ? [] : deletableItems.map((item) => item.id));
  }

  function personLabel(name?: string, email?: string, department?: string, position?: string) {
    const displayName = name || email || "-";
    const details = [department, position].filter(Boolean);
    return { name: displayName, details: details.join(" / ") };
  }

  function authorLabel(item: BoardPost) {
    const name = item.author_name || item.author_email || "-";
    const details = [item.author_department, item.author_position].filter(Boolean);
    return { name, details: details.join(" / ") };
  }

  function renderPerson(person: { name: string; details: string }) {
    return (
      <div className="person-cell">
        <strong>{person.name}</strong>
        {person.details && <span>{person.details}</span>}
      </div>
    );
  }

  function renderAuthor(item: BoardPost) {
    return renderPerson(authorLabel(item));
  }

  function renderCommentAuthor(comment: BoardComment) {
    return renderPerson(personLabel(comment.author_name, comment.author_email, comment.author_department, comment.author_position));
  }

  function renderDetailFiles(item: BoardPost) {
    return (
      <AttachmentList
        files={item.files}
        onDownload={handleDownloadFile}
        onDownloadAll={item.files && item.files.length > 1 ? () => handleDownloadAllFiles(item) : undefined}
      />
    );
  }

  return (
    <AppShell title={title} description={description}>
      {message && <p className="notice error">{message}</p>}

      <section className="editor-layout collapsed">
        <section className="panel">
          <div className="panel-head">
            <h2>{listTitle}</h2>
            <span>{isLoading ? "조회 중" : `${items.length}건`}</span>
          </div>
          <form className="list-filter-bar board-filter-bar" onSubmit={handleSearch}>
            <label className="search-field">
              <input
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="제목, 내용, 작성자 검색"
                value={searchInput}
              />
            </label>
            {canFilterBoardType && (
              <label className="filter-field">
                <select onChange={(event) => setBoardTypeFilter(event.target.value)} value={boardTypeFilter}>
                  <option value="">게시판 전체</option>
                  {allowedTypes.map((value) => (
                    <option key={value} value={value}>
                      {labelOf(boardTypeLabels, value)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="table-actions">
              {!!selectedDeleteIds.length && (
                <button className="danger-button" onClick={handleBulkDelete} type="button">
                  선택 삭제 {selectedDeleteIds.length}
                </button>
              )}
              <button className="primary-button" type="submit">
                검색
              </button>
              {(searchTerm || boardTypeFilter) && (
                <button className="ghost-button" onClick={clearSearch} type="button">
                  초기화
                </button>
              )}
              <button className={isEditorOpen ? "ghost-button" : "primary-button"} onClick={openCreateForm} type="button">
                {isEditorOpen ? `${resolvedEntityLabel} 등록 닫기` : `${resolvedEntityLabel} 등록`}
              </button>
            </div>
          </form>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      aria-label="삭제 대상 전체 선택"
                      checked={allDeletableSelected}
                      disabled={!deletableItems.length}
                      onChange={toggleAllDeleteSelection}
                      type="checkbox"
                    />
                  </th>
                  <th>제목</th>
                  <th>작성자</th>
                  <th>첨부</th>
                  <th>작성일</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {canDeletePost(item) && (
                        <input
                          aria-label={`${item.title} 삭제 선택`}
                          checked={selectedDeleteIds.includes(item.id)}
                          onChange={() => toggleDeleteSelection(item.id)}
                          type="checkbox"
                        />
                      )}
                    </td>
                    <td>
                      {item.is_locked && <span aria-label="잠금">🔒 </span>}
                      {item.is_pinned && <span className="status-pill muted">고정</span>}{" "}
                      <button className="table-title-button" onClick={() => openDetail(item)} type="button">
                        {item.title}
                      </button>
                    </td>
                    <td>{renderAuthor(item)}</td>
                    <td>{item.file_count ?? 0}</td>
                    <td>{formatDateTime(item.created_at)}</td>
                    <td className="table-actions">
                      {canEditPost(item) && (
                        <button className="ghost-button" onClick={() => startEdit(item)} type="button">
                          수정
                        </button>
                      )}
                      {canDeletePost(item) && (
                        <button className="danger-button" onClick={() => handleDelete(item.id)} type="button">
                          삭제
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={6}>{emptyMessage}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {detailTarget && (
        <div className="modal-backdrop">
          <div className="modal-panel report-detail-modal">
            <div className="panel-head">
              <h2>{resolvedEntityLabel} 내용</h2>
              <button className="ghost-button" onClick={() => setDetailTarget(null)} type="button">
                닫기
              </button>
            </div>

            <div className="report-detail-head">
              <strong>{detailTarget.title}</strong>
              {detailTarget.is_pinned && <span>고정</span>}
            </div>

            <dl className="report-detail-meta">
              <div>
                <dt>작성자</dt>
                <dd>{renderAuthor(detailTarget)}</dd>
              </div>
              <div>
                <dt>작성일</dt>
                <dd>{formatDateTime(detailTarget.created_at)}</dd>
              </div>
              <div>
                <dt>첨부</dt>
                <dd>{detailTarget.files?.length ?? detailTarget.file_count ?? 0}개</dd>
              </div>
            </dl>

            <section className="report-detail-section">
              <h3>내용</h3>
              <p className="report-detail-content">{detailTarget.content?.trim() || "작성된 내용이 없습니다."}</p>
            </section>

            <section className="report-detail-section">
              <h3>첨부</h3>
              {renderDetailFiles(detailTarget)}
            </section>

            {enableComments && (
              <section className="report-detail-section">
                <h3>댓글</h3>
                <div className="comment-list">
                  {detailComments.map((comment) => (
                    <article className="comment-card" key={comment.id}>
                      <div className="comment-card-head">
                        {renderCommentAuthor(comment)}
                        <time>{formatDateTime(comment.created_at)}</time>
                      </div>
                      <p>{comment.content}</p>
                      {!!comment.files?.length && (
                        <AttachmentList files={comment.files} onDownload={handleDownloadCommentFile} />
                      )}
                      {comment.author === user?.id && (
                        <div className="table-actions">
                          <button className="ghost-button" onClick={() => startEditComment(comment)} type="button">
                            수정
                          </button>
                          <button className="danger-button" onClick={() => handleDeleteComment(comment.id)} type="button">
                            삭제
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                  {!detailComments.length && <p className="report-detail-empty">댓글이 없습니다.</p>}
                </div>
                <form className="comment-form" onSubmit={handleSubmitComment}>
                  <textarea
                    onChange={(event) => setCommentInput(event.target.value)}
                    placeholder="댓글 작성"
                    value={commentInput}
                  />
                  <input accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(event) => handleCommentFiles(Array.from(event.target.files ?? []))} type="file" />
                  {!!commentPreviewUrls.length && (
                    <div className="comment-image-preview-list">
                      {commentPreviewUrls.map((url, index) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt={`댓글 이미지 ${index + 1}`} key={url} src={url} />
                      ))}
                    </div>
                  )}
                  <button className="primary-button" disabled={isCommentSaving || !commentInput.trim()} type="submit">
                    {isCommentSaving ? "등록 중" : editingCommentId ? "댓글 수정" : "댓글 등록"}
                  </button>
                </form>
              </section>
            )}
          </div>
        </div>
      )}

      {isEditorOpen && (
        <div className="modal-backdrop">
          <form className="modal-panel report-detail-modal form-stack report-editor-modal" onSubmit={handleSubmit}>
            <div className="panel-head">
              <h2>{editingId ? `${resolvedEntityLabel} 수정` : `새 ${resolvedEntityLabel}`}</h2>
              <button className="ghost-button" onClick={openCreateForm} type="button">
                {resolvedEntityLabel} 등록 닫기
              </button>
            </div>

            <div className="report-detail-head">
              <strong>{form.title || `새 ${resolvedEntityLabel}`}</strong>
              <span>{labelOf(boardTypeLabels, form.board_type)}</span>
            </div>

            <div className="report-detail-meta">
              {!fixedBoardType && (
                <label>
                  <dt>게시판</dt>
                  <dd>
                    <select onChange={(event) => setForm((current) => ({ ...current, board_type: event.target.value }))} value={form.board_type}>
                      {allowedTypes.map((value) => (
                        <option key={value} value={value}>{labelOf(boardTypeLabels, value)}</option>
                      ))}
                    </select>
                  </dd>
                </label>
              )}
              {form.board_type === "DATA_ROOM" && (
                <label>
                  <dt>공개 범위</dt>
                  <dd>
                    <select onChange={(event) => setForm((current) => ({ ...current, permission: event.target.value }))} value={form.permission ?? "PUBLIC"}>
                      <option value="PUBLIC">전체공개</option>
                      <option value="DEPARTMENT">부서공개</option>
                      <option value="SPECIFIC">지정인원</option>
                    </select>
                  </dd>
                </label>
              )}
              <label>
                <dt>첨부</dt>
                <dd>
                  <input multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} type="file" />
                  {!!files.length && <small>{files.length}개 선택됨</small>}
                </dd>
              </label>
            </div>

            {form.board_type === "DATA_ROOM" && form.permission === "SPECIFIC" && (
              <section className="report-detail-section">
                <label>
                  <h3>지정인원</h3>
                  <input onChange={(event) => setUserSearch(event.target.value)} placeholder="이름, 이메일, 부서 검색" value={userSearch} />
                </label>
                <div className="recipient-picker board-user-picker">
                  {filteredUsers.slice(0, 8).map((item) => (
                    <label className="check-label recipient-option" key={item.id}>
                      <input checked={specificUserIds.includes(item.id)} onChange={() => toggleSpecificUser(item.id)} type="checkbox" />
                      {item.display_name ?? item.email}
                    </label>
                  ))}
                </div>
              </section>
            )}

            <section className="report-detail-section">
              <label>
                <h3>제목</h3>
                <input onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required value={form.title} />
              </label>
            </section>

            <section className="report-detail-section">
              <label>
                <h3>내용</h3>
                <textarea onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} required rows={8} value={form.content} />
              </label>
            </section>

            <div className="form-row">
              {form.board_type === "NOTICE" && (
                <label className="check-label">
                  <input checked={Boolean(form.is_notice)} onChange={(event) => setForm((current) => ({ ...current, is_notice: event.target.checked }))} type="checkbox" />
                  공지글
                </label>
              )}
              <label className="check-label">
                <input checked={Boolean(form.is_pinned)} onChange={(event) => setForm((current) => ({ ...current, is_pinned: event.target.checked }))} type="checkbox" />
                상단 고정
              </label>
            </div>

            <button className="primary-button" disabled={isSaving} type="submit">
              {isSaving ? "저장 중" : editingId ? "수정" : "등록"}
            </button>
          </form>
        </div>
      )}
    </AppShell>
  );
}

export default function BoardsPage() {
  return <BoardsPageContent />;
}
