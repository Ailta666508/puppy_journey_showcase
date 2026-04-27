import { redirect } from "next/navigation";

/** 已改为匿名进入「情侣空间」，不再使用邮箱登录页 */
export default function LoginPage() {
  redirect("/onboarding");
}
