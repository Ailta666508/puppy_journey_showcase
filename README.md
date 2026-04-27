# 滑雪小狗

以治愈系的「线条小狗」为主题 IP，这是一款专为异地情侣量身定制的**互动陪伴与共同成长**应用。

本项目巧妙融合了情侣空间、旅行日志、心愿墙与成就系统，用于记录双向奔赴的点滴回忆。更创新性地引入了「未来排练室」模块——通过多智能体技术，将情侣间的日常打卡与回忆沉淀，自动转化为个性化的 AI 小语种互动学习剧本。从而打造出一个从“日常陪伴鼓励”到“为未来相逢共同学习”的情感与成长闭环。

## 项目定位
- **核心目标**：打破物理距离的限制，通过游戏化互动与 AI 赋能的陪伴式学习，提升异地情侣的参与感与共同成长体验。探索大模型在亲密关系场景下的落地，提升异地情侣的陪伴感与共同探索新技能的乐趣。
- **产品形态**：
  - `puppy-journey`：Next.js 全栈 Web 应用（前端 + API）
  - `rehearsal_backend`：Python / LangGraph 编排原型（独立实验后端）

## 功能概览
### 1) 情侣空间（Onboarding + 身份绑定）
- 匿名会话进入（Supabase Anonymous Auth）
- 选择角色：`yellow_dog` / `white_dog`
- 创建房间邀请码或加入房间
- 情侣双方配对完成后进入主流程
对应页面与接口：
- 页面：`src/app/onboarding/page.tsx`
- API：`/api/couple/create-room`、`/api/couple/join`、`/api/couple/leave`、`/api/couple/me`、`/api/couple/set-role`
### 2) 主页（双狗靠近进度）
- 展示“下一次见面 / 结束分离状态”双进度目标
- 与成就积分联动，支持动画反馈（彩带、贴贴）
对应页面：
- `src/app/(main)/page.tsx`
### 3) 旅行日志
- 结构化记录：标题、日期、地点、随笔、多图
- 支持图片上传/存储（Supabase Storage）
- 时间线展示，数据可作为后续 AI 上下文
对应页面与接口：
- 页面：`src/app/travel/page.tsx`
- API：`/api/travel-logs`、`/api/travel-logs/[id]`、`/api/travel-logs/upload-photo`
### 4) 心愿墙
- 新建/查看/完成/删除心愿
- 地图与时间线联动，展示“去过的城市”与“许愿瓶”
对应页面与接口：
- 页面：`src/app/wishes/page.tsx`、`src/app/wishes/new/page.tsx`
- API：`/api/wishes`、`/api/wishes/[id]`
### 5) 成就系统
- 双列任务板（自己 / 对方）
- 状态岛、专注模式、盲盒挂载与拆盒流程
- presence（在线状态/悄悄话）同步
对应页面与接口：
- 页面：`src/app/achievements/page.tsx`
- API：`/api/achievements/bootstrap`、`/api/achievements/tasks`、`/api/achievements/presence`、`/api/achievements/bond-summary`、`/api/achievements/whisper/read`
### 6) 未来排练室
- 剧场化学习视图（脚本、关键帧、视频、词汇流）
- 后端管线：脚本生成 → 图像生成 → 视频任务 → 状态轮询
- SOS 句子辅助（发音/跟读提示）
对应页面与接口：
- 页面：`src/app/learning/page.tsx`
- 组件：`src/components/learning/RehearsalTheaterView.tsx`
- API：`/api/pipeline/script`、`/api/pipeline/image`、`/api/pipeline/video/start`、`/api/pipeline/jobs/[id]`、`/api/rehearsal`、`/api/rehearsal/sos`
---
## 技术架构
## 总体架构
- **前端**：Next.js App Router + React 19 + TypeScript + Tailwind CSS
- **状态管理**：Zustand（含持久化）
- **后端能力**：Next.js Route Handlers（Node.js runtime）
- **数据库/鉴权/存储**：Supabase（Postgres + Auth + Storage）
- **AI 能力**：
  - OpenAI 兼容调用（脚本类）
  - 火山方舟（Q版图像、图生视频）
  - 可切换 mock / http provider
## 代码分层（`puppy-journey`）
- `src/app/*`：页面路由（UI 入口）
- `src/app/api/*`：BFF API 路由（鉴权、参数校验、业务编排）
- `src/components/*`：业务组件与 UI 组件
- `src/lib/*`：基础库（Supabase、pipeline、auth、db 映射、工具函数）
- `src/store/useAppStore.ts`：全局客户端状态
- `supabase/migrations/*`：数据库结构和策略演进
## 数据边界与安全
- 以情侣空间（`couple_id`）做主要数据隔离边界
- API 层通过 `requireCoupleWorkspaceContext` / `requireBearerUser` 进行上下文校验
- 服务端私钥仅使用 `SUPABASE_SERVICE_ROLE_KEY`
- 浏览器仅使用 `NEXT_PUBLIC_*` 变量（公开级别）
---
## Monorepo 目录结构
```text
.
├─ puppy-journey/               # 主应用（Next.js）
│  ├─ src/
│  ├─ public/
│  ├─ supabase/migrations/
│  └─ package.json
├─ rehearsal_backend/           # LangGraph 原型后端（Python）
│  ├─ rehearsal_graph.py
│  ├─ ai_wrapper.py
│  └─ .env.local (本地私密，不入库)
└─ docs/assets/...              # 需求文档、素材等
本地开发
1. 安装依赖
cd puppy-journey
pnpm install
2. 配置环境变量
在 puppy-journey 下创建 .env.local（可参考 .env.example）。

最关键变量（生产建议至少配置）：

NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
AI 相关（按需）：

PIPELINE_SCRIPT_LLM_API_KEY
PIPELINE_SCRIPT_LLM_BASE_URL
PIPELINE_SCRIPT_LLM_MODEL（或 PIPELINE_SCRIPT_LLM_ENDPOINT_ID）
VOLCENGINE_Q_AVATAR_API_KEY
VOLCENGINE_Q_AVATAR_ENDPOINT_ID
PIPELINE_VIDEO_API_KEY
PIPELINE_VIDEO_BASE_URL
PIPELINE_VIDEO_MODEL
PIPELINE_VIDEO_PROVIDER
3. 启动开发服务器
pnpm dev
默认访问：http://localhost:3000

部署（Vercel）
本仓库是 monorepo，部署 puppy-journey 时请注意：

Root Directory 设为：puppy-journey
Framework 选择：Next.js
在 Vercel 项目中配置上述环境变量（尤其 Supabase 三项）
