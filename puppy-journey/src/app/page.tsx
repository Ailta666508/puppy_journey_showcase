import MainPage from "@/app/(main)/page";

export default function Home() {
  // 重要：`(main)` 是路由组目录，不会出现在 URL。
  // 所以把根路由 `/` 直接渲染主场景，避免用户误访问 `/(main)` 导致 404。
  return <MainPage />;
}
