import { useRouter } from "next/router";
import { useEffect } from "react";

export default function ExpensesRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/reports?type=expense");
  }, [router]);

  return null;
}
