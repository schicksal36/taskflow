import { FormEvent, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import {
  type AdminApprovalRequest,
  type BiometricCredential,
  type UserProfile,
  changePassword,
  createAdminApprovalRequest,
  deleteMe,
  deleteBiometricCredential,
  describeApiError,
  fetchBiometricCredentials,
  fetchMyAdminApprovalRequest,
  fetchProfile,
  requestBiometricRegisterOptions,
  toArray,
  updateMe,
  updateProfile,
  verifyBiometricRegister,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { createBiometricRegistration, isWebAuthnSupported } from "@/lib/webauthn";

export default function ProfilePage() {
  const { accessToken, logout, refreshUser, user } = useAuth();
  const [userForm, setUserForm] = useState({
    email: "",
    first_name: "",
    department: "",
    position: "",
  });
  const [profileForm, setProfileForm] = useState<UserProfile>({
    bio: "",
  });
  const [biometricItems, setBiometricItems] = useState<BiometricCredential[]>([]);
  const [deviceName, setDeviceName] = useState("");
  const [supportsBiometric, setSupportsBiometric] = useState(false);
  const [isBiometricLoading, setIsBiometricLoading] = useState(true);
  const [passwordForm, setPasswordForm] = useState({
    old_password: "",
    new_password: "",
    new_password_confirm: "",
  });
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isAdminApplyOpen, setIsAdminApplyOpen] = useState(false);
  const [approval, setApproval] = useState<AdminApprovalRequest | null>(null);
  const [approvalForm, setApprovalForm] = useState({ reason: "", experience: "" });
  const [approvalMessage, setApprovalMessage] = useState("");
  const [isApprovalSaving, setIsApprovalSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setUserForm({
        email: user.email ?? "",
        first_name: user.first_name ?? "",
        department: user.department ?? "",
        position: user.position ?? "",
      });
    }
  }, [user]);

  useEffect(() => {
    setSupportsBiometric(isWebAuthnSupported());
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      if (!accessToken) {
        return;
      }

      try {
        const profile = await fetchProfile(accessToken);
        if (isMounted) {
          setProfileForm({
            bio: profile.bio ?? "",
          });
        }
      } catch (error) {
        if (isMounted) {
          setMessage(describeApiError(error));
        }
      }
    }

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, [accessToken]);

  async function loadBiometricItems() {
    if (!accessToken) {
      return;
    }

    setIsBiometricLoading(true);

    try {
      const response = await fetchBiometricCredentials(accessToken);
      setBiometricItems(toArray(response));
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsBiometricLoading(false);
    }
  }

  useEffect(() => {
    loadBiometricItems();
    // loadBiometricItems는 등록/삭제 후에도 재사용하므로 accessToken만 의존합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    let isMounted = true;

    async function loadApproval() {
      if (!accessToken || user?.role !== "USER") {
        setApproval(null);
        return;
      }

      try {
        const nextApproval = await fetchMyAdminApprovalRequest(accessToken);
        if (isMounted) {
          setApproval(nextApproval);
        }
      } catch {
        if (isMounted) {
          setApproval(null);
        }
      }
    }

    loadApproval();

    return () => {
      isMounted = false;
    };
  }, [accessToken, user?.role]);

  async function handleUserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      await updateMe(accessToken, userForm);
      await updateProfile(accessToken, profileForm);
      await refreshUser();
      setMessage("마이페이지 정보가 저장되었습니다.");
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      await changePassword(accessToken, passwordForm);
      setPasswordForm({ old_password: "", new_password: "", new_password_confirm: "" });
      setMessage("비밀번호가 변경되었습니다.");
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteAccount() {
    if (!accessToken) {
      return;
    }
    if (!window.confirm("정말 탈퇴하시겠습니까? 모든 데이터가 삭제됩니다.")) {
      return;
    }

    try {
      await deleteMe(accessToken);
      await logout();
      window.location.href = "/login";
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleBiometricRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !supportsBiometric) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      const options = await requestBiometricRegisterOptions(accessToken, { device_name: deviceName });
      const payload = await createBiometricRegistration(options, deviceName);
      await verifyBiometricRegister(accessToken, payload);
      setDeviceName("");
      await loadBiometricItems();
      setMessage("생체인식 기기가 등록되었습니다.");
    } catch (error) {
      setMessage(describeApiError(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleBiometricDelete(id: number) {
    if (!accessToken) {
      return;
    }

    setMessage("");

    try {
      await deleteBiometricCredential(accessToken, id);
      await loadBiometricItems();
      setMessage("생체인식 기기가 삭제되었습니다.");
    } catch (error) {
      setMessage(describeApiError(error));
    }
  }

  async function handleAdminApprovalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) {
      return;
    }

    setIsApprovalSaving(true);
    setApprovalMessage("");

    try {
      const nextApproval = await createAdminApprovalRequest(accessToken, approvalForm);
      setApproval(nextApproval);
      setApprovalForm({ reason: "", experience: "" });
      setApprovalMessage("관리자 신청이 접수되었습니다.");
    } catch (error) {
      setApprovalMessage(describeApiError(error));
    } finally {
      setIsApprovalSaving(false);
    }
  }

  const roleLabel = user?.role === "CEO" ? "대표이사" : user?.role === "ADMIN" ? "관리자" : "일반사용자";
  const displayName = user?.first_name || user?.username || user?.email || "";
  const approvalStatusLabel =
    approval?.status === "PENDING"
      ? "검토중"
      : approval?.status === "APPROVED"
        ? "승인"
        : approval?.status === "REJECTED"
          ? "거절"
          : "신규";

  return (
    <AppShell
      title="마이페이지"
      description="사용자 정보와 프로필 API로 내 정보를 관리합니다."
      actions={
        user?.role === "USER" ? (
          <button className="profile-admin-action" onClick={() => setIsAdminApplyOpen(true)} type="button">
            <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
              <path
                d="M12 3.5 18.5 6v5.1c0 4.1-2.6 7.8-6.5 9.4-3.9-1.6-6.5-5.3-6.5-9.4V6L12 3.5Z"
                stroke="currentColor"
                strokeLinejoin="round"
                strokeWidth="2"
              />
              <path d="M9.2 12.1 11 13.9l3.9-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
            <span>관리자 신청</span>
          </button>
        ) : undefined
      }
    >
      {message && <p className={message.includes("저장") || message.includes("변경") ? "notice" : "notice error"}>{message}</p>}

      <section className="profile-grid">
        <form className="panel form-stack" onSubmit={handleUserSubmit}>
          <div className="panel-head">
            <h2>기본 정보</h2>
            <span>{roleLabel}</span>
          </div>

          <label>
            <span>이메일</span>
            <input
              onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
              required
              type="email"
              value={userForm.email}
            />
          </label>

          <label>
            <span>이름</span>
            <input
              onChange={(event) => setUserForm((current) => ({ ...current, first_name: event.target.value }))}
              value={userForm.first_name}
            />
          </label>

          <div className="form-grid two">
            <label>
              <span>부서</span>
              <input
                onChange={(event) => setUserForm((current) => ({ ...current, department: event.target.value }))}
                value={userForm.department}
              />
            </label>
            <label>
              <span>직함</span>
              <input
                onChange={(event) => setUserForm((current) => ({ ...current, position: event.target.value }))}
                value={userForm.position}
              />
            </label>
          </div>

          <label>
            <span>소개</span>
            <textarea
              onChange={(event) => setProfileForm((current) => ({ ...current, bio: event.target.value }))}
              rows={4}
              value={profileForm.bio}
            />
          </label>

          <button className="primary-button" disabled={isSaving} type="submit">
            저장
          </button>
        </form>

        <form className="panel form-stack" onSubmit={handlePasswordSubmit}>
          <div className="panel-head">
            <h2>비밀번호 변경</h2>
          </div>

          <label>
            <span>현재 비밀번호</span>
            <input
              autoComplete="current-password"
              onChange={(event) => setPasswordForm((current) => ({ ...current, old_password: event.target.value }))}
              required
              type="password"
              value={passwordForm.old_password}
            />
          </label>

          <label>
            <span>새 비밀번호</span>
            <input
              autoComplete="new-password"
              onChange={(event) => setPasswordForm((current) => ({ ...current, new_password: event.target.value }))}
              required
              type="password"
              value={passwordForm.new_password}
            />
          </label>

          <label>
            <span>새 비밀번호 확인</span>
            <input
              autoComplete="new-password"
              onChange={(event) => setPasswordForm((current) => ({ ...current, new_password_confirm: event.target.value }))}
              required
              type="password"
              value={passwordForm.new_password_confirm}
            />
          </label>

          <button className="secondary-button" disabled={isSaving} type="submit">
            비밀번호 변경
          </button>
        </form>
      </section>

      <section className="editor-layout">
        <form className="panel form-stack" onSubmit={handleBiometricRegister}>
          <div className="panel-head">
            <h2>생체인식 설정</h2>
            <span>{biometricItems.length ? "사용중" : "미등록"}</span>
          </div>

          {!supportsBiometric && <p className="notice">현재 브라우저는 WebAuthn 생체인식을 지원하지 않습니다.</p>}

          <label>
            <span>기기 이름</span>
            <input
              onChange={(event) => setDeviceName(event.target.value)}
              placeholder="예: 사무실 Mac Touch ID"
              value={deviceName}
            />
          </label>

          <button className="primary-button" disabled={isSaving || !supportsBiometric} type="submit">
            {isSaving ? "등록 중" : "생체인식 등록"}
          </button>
        </form>

        <section className="panel">
          <div className="panel-head">
            <h2>등록된 기기</h2>
            <span>{isBiometricLoading ? "조회 중" : `${biometricItems.length}건`}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>기기</th>
                  <th>등록일</th>
                  <th>최근 사용</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {biometricItems.map((item) => (
                  <tr key={item.id}>
                    <td>{item.device_name || "이름 없는 기기"}</td>
                    <td>{formatDateTime(item.created_at)}</td>
                    <td>{formatDateTime(item.last_used_at)}</td>
                    <td className="table-actions">
                      <button className="danger-button" onClick={() => handleBiometricDelete(item.id)} type="button">
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
                {!biometricItems.length && (
                  <tr>
                    <td colSpan={4}>등록된 생체인식 기기가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <section className="panel form-stack danger-zone">
        <div className="panel-head">
          <h2>회원 탈퇴</h2>
        </div>
        <p className="notice error">탈퇴하면 계정이 비활성화되며 다시 로그인할 수 없습니다.</p>
        <button className="danger-button" onClick={handleDeleteAccount} type="button">
          회원 탈퇴
        </button>
      </section>

      {isAdminApplyOpen && (
        <div className="modal-backdrop">
          <div className="modal-panel report-detail-modal">
            <div className="panel-head">
              <h2>관리자 신청서</h2>
              <button className="ghost-button" onClick={() => setIsAdminApplyOpen(false)} type="button">
                닫기
              </button>
            </div>

            {approvalMessage && <p className={approvalMessage.includes("접수") ? "notice" : "notice error"}>{approvalMessage}</p>}

            <div className="report-detail-head">
              <strong>{displayName}</strong>
              <span>{approvalStatusLabel}</span>
            </div>

            {approval && approval.status !== "REJECTED" ? (
              <section className="report-detail-section">
                <p className="notice">
                  {approval.status === "PENDING" && "관리자 신청이 접수되었습니다. 대표이사 검토 중입니다."}
                  {approval.status === "APPROVED" && "관리자로 승격되었습니다."}
                </p>
              </section>
            ) : (
              <form className="form-stack admin-approval-form" onSubmit={handleAdminApprovalSubmit}>
                {approval?.status === "REJECTED" && (
                  <p className="notice error">이전 신청이 거절되었습니다. {approval.reject_reason ?? ""}</p>
                )}
                <section className="report-detail-section">
                  <label>
                    <h3>신청 사유</h3>
                    <textarea
                      onChange={(event) => setApprovalForm((current) => ({ ...current, reason: event.target.value }))}
                      required
                      rows={5}
                      value={approvalForm.reason}
                    />
                  </label>
                </section>
                <section className="report-detail-section">
                  <label>
                    <h3>관련 경력/업무 내용</h3>
                    <textarea
                      onChange={(event) => setApprovalForm((current) => ({ ...current, experience: event.target.value }))}
                      required
                      rows={5}
                      value={approvalForm.experience}
                    />
                  </label>
                </section>
                <button className="primary-button" disabled={isApprovalSaving} type="submit">
                  {isApprovalSaving ? "접수 중" : "관리자 신청"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
