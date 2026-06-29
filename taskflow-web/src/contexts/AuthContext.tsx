import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  type ApiUser,
  fetchMe,
  login as requestLogin,
  logout as requestLogout,
  refreshAccessToken,
  requestBiometricLoginOptions,
  register as requestRegister,
  verifyBiometricLogin,
} from "@/lib/api";
import { createBiometricAssertion } from "@/lib/webauthn";

type RegisterInput = {
  email: string;
  password: string;
  password_confirm: string;
  first_name?: string;
  department?: string;
  position?: string;
};

type AuthContextValue = {
  accessToken: string | null;
  refreshToken: string | null;
  user: ApiUser | null;
  isReady: boolean;
  login: (identifier: string, password: string, remember?: boolean) => Promise<ApiUser>;
  loginWithBiometric: (identifier: string, remember?: boolean) => Promise<ApiUser>;
  register: (input: RegisterInput) => Promise<ApiUser>;
  refreshUser: () => Promise<ApiUser | null>;
  logout: () => Promise<void>;
};

const ACCESS_KEY = "taskflow.access";
const REFRESH_KEY = "taskflow.refresh";
const USER_KEY = "taskflow.user";

const AuthContext = createContext<AuthContextValue | null>(null);

function getStoredValue(key: string) {
  return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
}

function readStoredUser() {
  const raw = getStoredValue(USER_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as ApiUser;
  } catch {
    window.localStorage.removeItem(USER_KEY);
    window.sessionStorage.removeItem(USER_KEY);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [isReady, setIsReady] = useState(false);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
    window.localStorage.removeItem(USER_KEY);
    window.sessionStorage.removeItem(ACCESS_KEY);
    window.sessionStorage.removeItem(REFRESH_KEY);
    window.sessionStorage.removeItem(USER_KEY);
  }, []);

  const storeSession = useCallback(
    (nextAccess: string, nextRefresh: string, nextUser: ApiUser, remember = true) => {
      setAccessToken(nextAccess);
      setRefreshToken(nextRefresh);
      setUser(nextUser);

      const targetStorage = remember ? window.localStorage : window.sessionStorage;
      const otherStorage = remember ? window.sessionStorage : window.localStorage;

      targetStorage.setItem(ACCESS_KEY, nextAccess);
      targetStorage.setItem(REFRESH_KEY, nextRefresh);
      targetStorage.setItem(USER_KEY, JSON.stringify(nextUser));
      otherStorage.removeItem(ACCESS_KEY);
      otherStorage.removeItem(REFRESH_KEY);
      otherStorage.removeItem(USER_KEY);
    },
    [],
  );

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      const storedAccess = getStoredValue(ACCESS_KEY);
      const storedRefresh = getStoredValue(REFRESH_KEY);
      const storedUser = readStoredUser();
      const remember = Boolean(window.localStorage.getItem(ACCESS_KEY));
      let restored = false;

      if (isMounted) {
        setAccessToken(storedAccess);
        setRefreshToken(storedRefresh);
        setUser(storedUser);
      }

      try {
        if (storedAccess) {
          const me = await fetchMe(storedAccess);
          if (isMounted) {
            storeSession(storedAccess, storedRefresh ?? "", me, remember);
          }
          restored = true;
        }
      } catch {
        // 만료된 access 토큰은 refresh 토큰으로 한 번 더 살려봅니다.
      }

      try {
        if (!restored && storedRefresh) {
          const refreshed = await refreshAccessToken(storedRefresh);
          const me = await fetchMe(refreshed.access);
          if (isMounted) {
            storeSession(refreshed.access, refreshed.refresh ?? storedRefresh, me, remember);
          }
          restored = true;
        }
      } catch {
        if (isMounted) {
          clearSession();
        }
      } finally {
        if (isMounted) {
          if (!restored && (storedAccess || storedRefresh)) {
            clearSession();
          }
          setIsReady(true);
        }
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, [clearSession, storeSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      refreshToken,
      user,
      isReady,
      async login(identifier, password, remember = true) {
        const payload = await requestLogin(identifier, password);
        storeSession(payload.access, payload.refresh, payload.user, remember);
        return payload.user;
      },
      async loginWithBiometric(identifier, remember = true) {
        const options = await requestBiometricLoginOptions(identifier);
        const assertion = await createBiometricAssertion(options);
        const payload = await verifyBiometricLogin(assertion);
        storeSession(payload.access, payload.refresh, payload.user, remember);
        return payload.user;
      },
      async register(input) {
        await requestRegister(input);
        const payload = await requestLogin(input.email, input.password);
        storeSession(payload.access, payload.refresh, payload.user, true);
        return payload.user;
      },
      async refreshUser() {
        if (!accessToken) {
          return null;
        }

        const me = await fetchMe(accessToken);
        storeSession(accessToken, refreshToken ?? "", me, Boolean(window.localStorage.getItem(ACCESS_KEY)));
        return me;
      },
      async logout() {
        const tokenToRevoke = refreshToken;
        clearSession();

        if (tokenToRevoke) {
          try {
            await requestLogout(tokenToRevoke);
          } catch {
            // 서버 로그아웃 실패와 관계없이 브라우저 세션은 이미 지웠습니다.
          }
        }
      },
    }),
    [accessToken, clearSession, isReady, refreshToken, storeSession, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return value;
}
