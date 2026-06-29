import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";
import { fetchNotificationCount } from "@/lib/api";

type AppShellProps = {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
};

const navigation = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/admin/users", label: "계정관리", roles: ["CEO", "ADMIN", "SUPERUSER"] },
  { href: "/work-requests", label: "업무요청" },
  { href: "/todos", label: "내 할 일" },
  { href: "/schedules", label: "일정관리" },
  { href: "/reports", label: "업무보고" },
  { href: "/expenses", label: "경비지출" },
  { href: "/boards", label: "게시판" },
  { href: "/data-room", label: "자료실" },
  { href: "/notifications", label: "알림센터" },
  { href: "/profile", label: "마이페이지" },
];

const quickLinks = [
  { href: "/work-requests?mode=create", label: "업무요청 하기" },
  { href: "/schedules?mode=create", label: "일정 등록" },
  { href: "/reports?mode=create", label: "보고서 작성" },
];

function formatToday() {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(new Date());
}

export function AppShell({ title, description, children, actions }: AppShellProps) {
  const router = useRouter();
  const { accessToken, isReady, logout, user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const isSuperuser = user?.role === "SUPERUSER";

  useEffect(() => {
    if (isReady && !accessToken) {
      router.replace("/login");
    }
  }, [accessToken, isReady, router]);

  useEffect(() => {
    if (isReady && accessToken && isSuperuser && router.pathname !== "/admin/users") {
      router.replace("/admin/users");
    }
  }, [accessToken, isReady, isSuperuser, router]);

  useEffect(() => {
    let isMounted = true;

    async function loadCount() {
      if (!accessToken || isSuperuser) {
        setUnreadCount(0);
        return;
      }

      try {
        const count = await fetchNotificationCount(accessToken);
        if (isMounted) {
          setUnreadCount(count.unread_count ?? 0);
        }
      } catch {
        if (isMounted) {
          setUnreadCount(0);
        }
      }
    }

    loadCount();

    return () => {
      isMounted = false;
    };
  }, [accessToken, isSuperuser]);

  const displayName = useMemo(() => {
    if (!user) {
      return "";
    }

    return user.first_name || user.username || user.email;
  }, [user]);
  const visibleQuickLinks = useMemo(() => {
    if (isSuperuser) {
      return [];
    }
    if (user?.role === "CEO" || user?.role === "SUPERUSER") {
      return quickLinks.filter((item) => item.href !== "/reports?mode=create");
    }

    return quickLinks;
  }, [isSuperuser, user?.role]);
  const visibleNavigation = useMemo(() => {
    if (isSuperuser) {
      return navigation.filter((item) => item.href === "/admin/users");
    }

    return navigation.filter((item) => !item.roles || item.roles.includes(user?.role ?? ""));
  }, [isSuperuser, user?.role]);

  if (!isReady || !accessToken) {
    return (
      <main className="page-loading">
        <Logo />
        <p>화면을 준비하고 있습니다.</p>
      </main>
    );
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Link href={isSuperuser ? "/admin/users" : "/dashboard"} className="sidebar-logo" aria-label="홈으로 이동">
          <Logo />
        </Link>

        <nav className="side-nav" aria-label="주 메뉴">
          {visibleNavigation.map((item) => {
            const isActive =
              router.pathname === item.href || (item.href !== "/dashboard" && router.pathname.startsWith(item.href));

            return (
              <Link key={item.href} href={item.href} className={isActive ? "active" : ""}>
                <span className="nav-dot" aria-hidden="true" />
                {item.label}
                {item.href === "/notifications" && unreadCount > 0 && (
                  <span className="count-badge">{unreadCount}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {!!visibleQuickLinks.length && (
          <div className="quick-panel">
            <p>Quick Menu</p>
            {visibleQuickLinks.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
                <span aria-hidden="true">›</span>
              </Link>
            ))}
          </div>
        )}
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <strong>{formatToday()}</strong>
          </div>
          <div className="topbar-user">
            {!isSuperuser && (
              <Link href="/notifications" className="notification-link">
                알림
                {unreadCount > 0 && <span>{unreadCount}</span>}
              </Link>
            )}
            {!isSuperuser && <Link href="/profile">{displayName}</Link>}
            {isSuperuser && <strong>{displayName}</strong>}
            <button type="button" className="ghost-button" onClick={() => logout()}>
              로그아웃
            </button>
          </div>
        </header>

        <main className="content">
          <div className="page-heading">
            <div>
              <h1>{title}</h1>
              {description && <p>{description}</p>}
            </div>
            {actions && <div className="page-actions">{actions}</div>}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
