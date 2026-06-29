import { useRouter } from "next/router";
import { useEffect } from "react";
import Link from "next/link";

import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";

export default function HomePage() {
  const router = useRouter();
  const { accessToken, isReady, user } = useAuth();

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const target = accessToken ? (user?.role === "SUPERUSER" ? "/admin/users" : "/dashboard") : "/login";
    router.replace(target);

    const fallback = window.setTimeout(() => {
      window.location.assign(target);
    }, 1200);

    return () => window.clearTimeout(fallback);
  }, [accessToken, isReady, router, user?.role]);

  return (
    <main className="page-loading">
      <Logo />
      <p>{isReady ? "화면을 이동하고 있습니다." : "화면을 준비하고 있습니다."}</p>
      <div className="table-actions">
        <Link className="primary-button" href="/login">
          로그인으로 이동
        </Link>
        <Link className="secondary-button" href="/dashboard">
          대시보드로 이동
        </Link>
      </div>
    </main>
  );
}
