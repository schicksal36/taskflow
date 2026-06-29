import type { ReactNode } from "react";

import { Logo } from "@/components/Logo";

type AuthLayoutProps = {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <main className="auth-page">
      <section className="auth-intro" aria-label="서비스 소개">
        <Logo />
        <div className="intro-copy">
          <h1>업무요청부터 처리, 관리까지 한 곳에서 효율적으로 관리하세요.</h1>
          <p>요청, 승인, 배정, 처리, 피드백의 전체 프로세스를 체계적으로 관리할 수 있습니다.</p>
        </div>
        <div className="auth-illustration" aria-hidden="true">
          <div className="illustration-window">
            <span />
            <span />
            <span />
            <div className="illustration-row" />
            <div className="illustration-row short" />
            <div className="illustration-row" />
          </div>
          <div className="illustration-card" />
          <div className="illustration-bars">
            <span />
            <span />
            <span />
          </div>
        </div>
        <p className="copyright">© 2024 JPARTNERS. All rights reserved.</p>
      </section>

      <section className="auth-panel" aria-label={title}>
        <div className="auth-card">
          <div className="auth-card-head">
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          {children}
          {footer && <div className="auth-card-foot">{footer}</div>}
        </div>
      </section>
    </main>
  );
}
