import Link from "next/link";
import { useRouter } from "next/router";
import { FormEvent, useEffect, useState } from "react";

import { AuthLayout } from "@/components/AuthLayout";
import { useAuth } from "@/contexts/AuthContext";
import { describeApiError } from "@/lib/api";
import { isWebAuthnSupported } from "@/lib/webauthn";

export default function LoginPage() {
  const router = useRouter();
  const { accessToken, isReady, login, loginWithBiometric } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [supportsBiometric, setSupportsBiometric] = useState(false);

  useEffect(() => {
    if (isReady && accessToken) {
      router.replace("/dashboard");
    }
  }, [accessToken, isReady, router]);

  useEffect(() => {
    setSupportsBiometric(isWebAuthnSupported());
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    try {
      await login(email, password, remember);
      router.replace("/dashboard");
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleBiometricLogin() {
    if (!email) {
      setMessage("생체인식 로그인에 사용할 이메일을 입력하세요.");
      return;
    }

    setMessage("");
    setIsSubmitting(true);

    try {
      await loginWithBiometric(email, remember);
      router.replace("/dashboard");
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout title="로그인" description="계정에 로그인하여 JPARTNERS를 이용하세요.">
      <form className="form-stack" onSubmit={handleSubmit}>
        <label>
          <span>이메일</span>
          <input
            autoComplete="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="이메일을 입력하세요"
            required
            type="email"
            value={email}
          />
        </label>

        <label>
          <span>비밀번호</span>
          <input
            autoComplete="current-password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="비밀번호를 입력하세요"
            required
            type="password"
            value={password}
          />
        </label>

        <div className="form-row between">
          <label className="check-label">
            <input checked={remember} onChange={(event) => setRemember(event.target.checked)} type="checkbox" />
            로그인 상태 유지
          </label>
          <div className="link-row">
            <Link href="/reset-password">비밀번호 찾기</Link>
          </div>
        </div>

        {message && <p className="form-error">{message}</p>}

        <button className="primary-button" disabled={isSubmitting} type="submit">
          {isSubmitting ? "로그인 중" : "로그인"}
        </button>

        {supportsBiometric && (
          <button className="secondary-button" disabled={isSubmitting} onClick={handleBiometricLogin} type="button">
            생체인식 로그인
          </button>
        )}

        <div className="divider">
          <span>또는</span>
        </div>

        <Link className="secondary-button" href="/register">
          회원가입
        </Link>
      </form>
    </AuthLayout>
  );
}
