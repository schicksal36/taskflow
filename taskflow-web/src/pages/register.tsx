import Link from "next/link";
import { useRouter } from "next/router";
import { FormEvent, useState } from "react";

import { AuthLayout } from "@/components/AuthLayout";
import { useAuth } from "@/contexts/AuthContext";
import { describeApiError } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [form, setForm] = useState({
    email: "",
    first_name: "",
    password: "",
    password_confirm: "",
    department: "",
    position: "",
  });
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField(name: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (form.password !== form.password_confirm) {
      setMessage("비밀번호와 비밀번호 확인이 서로 다릅니다.");
      return;
    }

    setIsSubmitting(true);

    try {
      await register(form);
      router.replace("/dashboard");
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout title="회원가입" description="JPARTNERS 계정을 생성하여 서비스를 이용하세요.">
      <form className="form-stack" onSubmit={handleSubmit}>
        <label>
          <span>이메일</span>
          <input
            autoComplete="email"
            onChange={(event) => updateField("email", event.target.value)}
            placeholder="이메일을 입력하세요"
            required
            type="email"
            value={form.email}
          />
        </label>

        <label>
          <span>이름</span>
          <input
            autoComplete="name"
            onChange={(event) => updateField("first_name", event.target.value)}
            placeholder="이름을 입력하세요"
            required
            value={form.first_name}
          />
        </label>

        <div className="form-grid two">
          <label>
            <span>부서</span>
            <input
              onChange={(event) => updateField("department", event.target.value)}
              placeholder="부서"
              value={form.department}
            />
          </label>
          <label>
            <span>직급</span>
            <input
              onChange={(event) => updateField("position", event.target.value)}
              placeholder="직급"
              value={form.position}
            />
          </label>
        </div>

        <label>
          <span>비밀번호</span>
          <input
            autoComplete="new-password"
            onChange={(event) => updateField("password", event.target.value)}
            placeholder="비밀번호를 입력하세요"
            required
            type="password"
            value={form.password}
          />
        </label>

        <label>
          <span>비밀번호 확인</span>
          <input
            autoComplete="new-password"
            onChange={(event) => updateField("password_confirm", event.target.value)}
            placeholder="비밀번호를 다시 입력하세요"
            required
            type="password"
            value={form.password_confirm}
          />
        </label>

        {message && <p className="form-error">{message}</p>}

        <button className="primary-button" disabled={isSubmitting} type="submit">
          {isSubmitting ? "가입 중" : "회원가입"}
        </button>

        <div className="divider">
          <span>또는</span>
        </div>

        <Link className="secondary-button" href="/login">
          로그인 페이지로 이동
        </Link>
      </form>
    </AuthLayout>
  );
}
