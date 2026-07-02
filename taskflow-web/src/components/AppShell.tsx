import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";
import { fetchNotificationCount } from "@/lib/api";
import { manualSections } from "@/lib/manual";
import { groupReleaseNotesByDate, releaseNotes } from "@/lib/releaseNotes";

type AppShellProps = {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
};

const navigation = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/admin/users", label: "계정관리", roles: ["CEO", "ADMIN", "SUPERUSER"] },
  { href: "/tasks", label: "업무관리" },
  { href: "/reports", label: "보고관리" },
  { href: "/schedules", label: "일정관리" },
  { href: "/data-room", label: "자료실" },
  ...(process.env.NODE_ENV === "development" ? [{ href: "/free-board", label: "자유게시판" }] : []),
];

const quickLinks = [
  { href: "/tasks", label: "업무 등록" },
  { href: "/schedules?mode=create", label: "일정 등록" },
  { href: "/reports?mode=create", label: "보고 작성" },
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
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [guideTab, setGuideTab] = useState<"manual" | "release">("manual");
  const [selectedManualIndex, setSelectedManualIndex] = useState(0);
  const [selectedReleaseIndex, setSelectedReleaseIndex] = useState(0);
  const isSuperuser = user?.role === "SUPERUSER";
  const recentManualSections = manualSections.slice(0, 4);
  const selectedManualSection = recentManualSections[selectedManualIndex] ?? recentManualSections[0];
  const recentReleaseNoteGroups = groupReleaseNotesByDate(releaseNotes).slice(0, 3);
  const selectedReleaseNoteGroup = recentReleaseNoteGroups[selectedReleaseIndex] ?? recentReleaseNoteGroups[0];

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
              <Link href="/notifications" className="notification-icon-link" aria-label="알림">
                <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
                  <path d="M15 17H9m10-1.5c-.9-1-1.5-2.1-1.5-3.8V9a5.5 5.5 0 0 0-11 0v2.7c0 1.7-.6 2.8-1.5 3.8-.5.6-.1 1.5.7 1.5h12.6c.8 0 1.2-.9.7-1.5ZM13.7 19a2 2 0 0 1-3.4 0" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
                {unreadCount > 0 && <span>{unreadCount}</span>}
              </Link>
            )}
            {!isSuperuser && (
              <button className="guide-topbar-button" onClick={() => setIsGuideOpen(true)} type="button">
                사용설명서
              </button>
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
              <div className="page-title-row">
                <h1>{title}</h1>
                {actions && <div className="page-actions">{actions}</div>}
              </div>
              {description && <p>{description}</p>}
            </div>
          </div>
          {children}
        </main>
      </div>

      {isGuideOpen && (
        <div className="modal-backdrop">
          <div className="modal-panel report-detail-modal guide-modal">
            <div className="panel-head">
              <h2>사용설명서</h2>
              <button className="ghost-button" onClick={() => setIsGuideOpen(false)} type="button">
                닫기
              </button>
            </div>
            <div className="tab-row compact-tabs">
              <button className={guideTab === "manual" ? "active" : ""} onClick={() => setGuideTab("manual")} type="button">
                사용설명서
              </button>
              <button className={guideTab === "release" ? "active" : ""} onClick={() => setGuideTab("release")} type="button">
                릴리즈노트
              </button>
            </div>

            {guideTab === "manual" ? (
              <>
                <div className="release-layout">
                  <div className="release-list">
                    {recentManualSections.map((section, index) => (
                      <button className={selectedManualIndex === index ? "active" : ""} key={section.category} onClick={() => setSelectedManualIndex(index)} type="button">
                        <strong>{section.category}</strong>
                        <span>{section.items.length}건</span>
                        <small>{section.items.map((item) => item.title).join(", ")}</small>
                      </button>
                    ))}
                  </div>
                  <section className="release-detail">
                    <span>{selectedManualSection.category}</span>
                    {selectedManualSection.items.map((item) => (
                      <article className="release-detail-note" key={`${selectedManualSection.category}-${item.title}`}>
                        <h3>{item.title}</h3>
                        <p>{item.summary}</p>
                        <ul>
                          {item.details.map((detail) => <li key={detail}>{detail}</li>)}
                        </ul>
                      </article>
                    ))}
                  </section>
                </div>
                <div className="guide-modal-actions">
                  <Link className="secondary-button small" href="/manual" onClick={() => setIsGuideOpen(false)}>
                    전체내역 보기
                  </Link>
                </div>
              </>
            ) : (
              <>
                <div className="release-layout">
                  <div className="release-list">
                    {recentReleaseNoteGroups.map((group, index) => (
                      <button className={selectedReleaseIndex === index ? "active" : ""} key={group.date} onClick={() => setSelectedReleaseIndex(index)} type="button">
                        <strong>{group.date}</strong>
                        <span>{group.notes.length}건</span>
                        <small>{group.notes.map((note) => note.title).join(", ")}</small>
                      </button>
                    ))}
                  </div>
                  <section className="release-detail">
                    <span>{selectedReleaseNoteGroup.date}</span>
                    {selectedReleaseNoteGroup.notes.map((note) => (
                      <article className="release-detail-note" key={`${note.date}-${note.title}`}>
                        <h3>{note.title}</h3>
                        <p>{note.summary}</p>
                        <ul>
                          {note.details.map((detail) => <li key={detail}>{detail}</li>)}
                        </ul>
                      </article>
                    ))}
                  </section>
                </div>
                <div className="guide-modal-actions">
                  <Link className="secondary-button small" href="/release-notes" onClick={() => setIsGuideOpen(false)}>
                    전체내역 보기
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
