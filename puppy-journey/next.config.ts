import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
    /** 旅行日志 Base64 多图 POST 较大；偏小会截断 body，导致 JSON 异常或入库失败 */
    proxyClientMaxBodySize: "50mb",
  },
};

export default nextConfig;
