import Link from "next/link";
import { FormEvent, useState } from "react";

import { AuthLayout } from "@/components/AuthLayout";
import { confirmPasswordReset, describeApiError, requestPasswordReset } from "@/lib/api";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRequestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    try {
      await requestPasswordReset(email);
      setMessage("인증번호 요청이 처리되었습니다. 메일 또는 서버 응답을 확인해주세요.");
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    try {
      await confirmPasswordReset({ email, code, new_password: newPassword });
      setMessage("비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요.");
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout title="비밀번호 찾기" description="인증번호를 받아 새 비밀번호를 설정합니다.">
      <div className="split-form">
        <form className="form-stack" onSubmit={handleRequestCode}>
          <label>
            <span>이메일</span>
            <input
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="가입한 이메일을 입력하세요"
              required
              type="email"
              value={email}
            />
          </label>
          <button className="secondary-button" disabled={isSubmitting} type="submit">
            인증번호 요청
          </button>
        </form>

        <form className="form-stack" onSubmit={handleReset}>
          <label>
            <span>인증번호</span>
            <input
              onChange={(event) => setCode(event.target.value)}
              placeholder="인증번호를 입력하세요"
              required
              value={code}
            />
          </label>
          <label>
            <span>새 비밀번호</span>
            <input
              autoComplete="new-password"
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="새 비밀번호를 입력하세요"
              required
              type="password"
              value={newPassword}
            />
          </label>
          <button className="primary-button" disabled={isSubmitting} type="submit">
            비밀번호 변경
          </button>
        </form>
      </div>

      {message && <p className="form-info">{message}</p>}

      <Link className="secondary-button" href="/login">
        로그인으로 돌아가기
      </Link>
    </AuthLayout>
  );
}
