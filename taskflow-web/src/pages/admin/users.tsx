import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import {
  type UserListItem,
  describeApiError,
  fetchAdminUsers,
  promoteAdminUser,
  toArray,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

function roleLabel(role?: string) {
  if (role === "CEO") {
    return "대표이사";
  }
  if (role === "ADMIN") {
    return "관리자";
  }
  if (role === "SUPERUSER") {
    return "슈퍼유저";
  }
  return "일반사용자";
}

export default function AdminUsersPage() {
  const { accessToken, user } = useAuth();
  const [items, setItems] = useState<UserListItem[]>([]);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  async function loadItems() {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      setItems(toArray(await fetchAdminUsers(accessToken)));
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function handlePromote(id: number) {
    if (!accessToken || !window.confirm("해당 사용자를 관리자로 승격하시겠습니까?")) {
      return;
    }

    try {
      await promoteAdminUser(accessToken, id);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  return (
    <AppShell title="계정관리" description="사용자 계정과 역할을 조회하고 관리합니다.">
      {message && <p className="notice error">{message}</p>}
      {user?.role !== "CEO" && user?.role !== "ADMIN" && user?.role !== "SUPERUSER" && (
        <p className="notice error">관리자 권한이 필요합니다.</p>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>전체 사용자</h2>
          <span>{isLoading ? "조회 중" : `${items.length}명`}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th>이메일</th>
                <th>부서</th>
                <th>직함</th>
                <th>역할</th>
                <th>가입일</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.display_name ?? item.first_name ?? "-"}</td>
                  <td>{item.email}</td>
                  <td>{item.department || "-"}</td>
                  <td>{item.position || "-"}</td>
                  <td>
                    <span className={`status-pill ${item.role === "ADMIN" ? "blue" : "muted"}`}>{roleLabel(item.role)}</span>
                  </td>
                  <td>{formatDateTime(item.date_joined)}</td>
                  <td className="table-actions">
                    {user?.role === "CEO" && item.role === "USER" && (
                      <button className="primary-button" onClick={() => handlePromote(item.id)} type="button">
                        관리자 승격
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan={7}>조회된 사용자가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
