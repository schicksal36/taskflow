import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import {
  type Notification,
  deleteAllNotifications,
  deleteNotification,
  describeApiError,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  toArray,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export default function NotificationsPage() {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  async function loadItems() {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetchNotifications(accessToken);
      setItems(toArray(response));
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
    // loadItems는 읽음/삭제 후에도 재사용하는 함수라 effect 의존성만 고정합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function handleRead(id: number) {
    if (!accessToken) {
      return;
    }

    try {
      await markNotificationRead(accessToken, id);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleReadAll() {
    if (!accessToken) {
      return;
    }

    try {
      await markAllNotificationsRead(accessToken);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleDelete(id: number) {
    if (!accessToken) {
      return;
    }

    try {
      await deleteNotification(accessToken, id);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleDeleteAll() {
    if (!accessToken || !items.length) {
      return;
    }
    if (!window.confirm("전체 알림을 삭제할까요?")) {
      return;
    }

    try {
      await deleteAllNotifications(accessToken);
      await loadItems();
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  return (
    <AppShell
      title="알림센터"
      description="알림 API로 알림을 조회하고 읽음 처리합니다."
      actions={
        <>
          <button className="secondary-button small" disabled={!items.length} onClick={handleReadAll} type="button">
            전체 읽음
          </button>
          <button className="danger-button small" disabled={!items.length} onClick={handleDeleteAll} type="button">
            전체 삭제
          </button>
        </>
      }
    >
      {message && <p className="notice error">{message}</p>}

      <section className="panel">
        <div className="panel-head">
          <h2>알림 목록</h2>
          <span>{isLoading ? "조회 중" : `${items.length}건`}</span>
        </div>

        <ul className="notification-list">
          {items.map((item) => (
            <li key={item.id} className={item.is_read ? "" : "unread"}>
              <div>
                <strong>{item.title}</strong>
                <p>{item.message}</p>
                <span>{formatDateTime(item.created_at)}</span>
              </div>
              <div className="table-actions">
                {!item.is_read && (
                  <button className="ghost-button" onClick={() => handleRead(item.id)} type="button">
                    읽음
                  </button>
                )}
                <button className="danger-button" onClick={() => handleDelete(item.id)} type="button">
                  삭제
                </button>
              </div>
            </li>
          ))}
          {!items.length && <li>조회된 알림이 없습니다.</li>}
        </ul>
      </section>
    </AppShell>
  );
}
