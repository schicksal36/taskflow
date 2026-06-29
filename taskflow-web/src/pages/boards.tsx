import { FormEvent, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import {
  type BoardPost,
  type BoardPostInput,
  type UserListItem,
  attachBoardFile,
  createBoardPost,
  deleteBoardPost,
  describeApiError,
  fetchBoardPosts,
  fetchUsers,
  toArray,
  updateBoardPost,
  uploadMediaFile,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { boardTypeLabels, labelOf } from "@/lib/labels";

const boardOptions = ["FREE", "NOTICE"];

export const emptyForm: BoardPostInput = {
  board_type: "FREE",
  title: "",
  content: "",
  is_notice: false,
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
};

export function BoardsPageContent({
  title = "게시판",
  description = "게시글 API로 사내 게시글을 등록하고 관리합니다.",
  listTitle = "게시글 목록",
  emptyMessage = "조회된 게시글이 없습니다.",
  allowedTypes = boardOptions,
  fixedBoardType,
}: BoardsPageContentProps) {
  const { accessToken, user } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "CEO" || user?.role === "SUPERUSER";
  const [items, setItems] = useState<BoardPost[]>([]);
  const [form, setForm] = useState<BoardPostInput>({ ...emptyForm, board_type: fixedBoardType ?? emptyForm.board_type });
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [specificUserIds, setSpecificUserIds] = useState<number[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  async function loadItems() {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const responses = await Promise.all(
        allowedTypes.map((boardType) => fetchBoardPosts(accessToken, boardType, searchTerm)),
      );
      setItems(responses.flatMap((response) => toArray(response)));
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
  }, [accessToken, searchTerm]);

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

  function resetForm() {
    setEditingId(null);
    setForm({ ...emptyForm, board_type: fixedBoardType ?? emptyForm.board_type });
    setSpecificUserIds([]);
    setFiles([]);
  }

  function startEdit(item: BoardPost) {
    setEditingId(item.id);
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
  }

  async function handleDelete(id: number) {
    if (!accessToken) {
      return;
    }

    try {
      await deleteBoardPost(accessToken, id);
      await loadItems();
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

  return (
    <AppShell title={title} description={description}>
      {message && <p className="notice error">{message}</p>}

      <section className="editor-layout">
        <form className="panel form-stack" onSubmit={handleSubmit}>
          <div className="panel-head">
            <h2>{editingId ? "게시글 수정" : "게시글 등록"}</h2>
            {editingId && (
              <button className="ghost-button" onClick={resetForm} type="button">
                취소
              </button>
            )}
          </div>

          {!fixedBoardType && (
            <label>
              <span>게시판</span>
              <select
                onChange={(event) => setForm((current) => ({ ...current, board_type: event.target.value }))}
                value={form.board_type}
              >
                {allowedTypes.map((value) => (
                  <option key={value} value={value}>
                    {labelOf(boardTypeLabels, value)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            <span>제목</span>
            <input
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              required
              value={form.title}
            />
          </label>

          <label>
            <span>내용</span>
            <textarea
              onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
              required
              rows={8}
              value={form.content}
            />
          </label>

          {form.board_type === "DATA_ROOM" && (
            <>
              <label>
                <span>자료실 권한</span>
                <select onChange={(event) => setForm((current) => ({ ...current, permission: event.target.value }))} value={form.permission ?? "PUBLIC"}>
                  <option value="PUBLIC">전체공개</option>
                  <option value="DEPARTMENT">부서공개</option>
                  <option value="SPECIFIC">지정인원</option>
                </select>
              </label>
              {form.permission === "SPECIFIC" && (
                <>
                  <label>
                    <span>지정인원</span>
                    <input onChange={(event) => setUserSearch(event.target.value)} placeholder="이름, 이메일, 부서 검색" value={userSearch} />
                  </label>
                  <div className="recipient-picker">
                    {filteredUsers.slice(0, 8).map((item) => (
                      <label className="check-label recipient-option" key={item.id}>
                        <input checked={specificUserIds.includes(item.id)} onChange={() => toggleSpecificUser(item.id)} type="checkbox" />
                        {item.display_name ?? item.email}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          <label>
            <span>첨부파일</span>
            <input multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} type="file" />
          </label>

          <div className="form-row">
            <label className="check-label">
              <input
                checked={Boolean(form.is_notice)}
                onChange={(event) => setForm((current) => ({ ...current, is_notice: event.target.checked }))}
                type="checkbox"
              />
              공지글
            </label>
            <label className="check-label">
              <input
                checked={Boolean(form.is_pinned)}
                onChange={(event) => setForm((current) => ({ ...current, is_pinned: event.target.checked }))}
                type="checkbox"
              />
              상단 고정
            </label>
          </div>

          <button className="primary-button" disabled={isSaving} type="submit">
            {isSaving ? "저장 중" : editingId ? "수정" : "등록"}
          </button>
        </form>

        <section className="panel">
          <div className="panel-head">
            <h2>{listTitle}</h2>
            <span>{isLoading ? "조회 중" : `${items.length}건`}</span>
          </div>
          <form className="list-filter-bar" onSubmit={handleSearch}>
            <label className="search-field">
              <input
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="제목, 내용, 작성자 검색"
                value={searchInput}
              />
            </label>
            <div className="table-actions">
              <button className="primary-button" type="submit">
                검색
              </button>
              {searchTerm && (
                <button className="ghost-button" onClick={clearSearch} type="button">
                  초기화
                </button>
              )}
            </div>
          </form>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>게시판</th>
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
                    <td>{labelOf(boardTypeLabels, item.board_type)}</td>
                    <td>
                      {item.is_locked && <span aria-label="잠금">🔒 </span>}
                      {item.is_pinned && <span className="status-pill muted">고정</span>} {item.title}
                    </td>
                    <td>{item.author_name || "-"}</td>
                    <td>{item.file_count ?? 0}</td>
                    <td>{formatDateTime(item.created_at)}</td>
                    <td className="table-actions">
                      <button className="ghost-button" onClick={() => startEdit(item)} type="button">
                        수정
                      </button>
                      {(isAdmin || item.author === user?.id) && (
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
    </AppShell>
  );
}

export default function BoardsPage() {
  return <BoardsPageContent />;
}
