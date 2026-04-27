
# 滑雪小狗（Puppy Journey）

> AI-native 的异地情侣互动与共同成长应用。  
> 通过多智能体编排将“日常陪伴数据”转化为“可互动学习内容”，形成从情感记录到能力共建的完整闭环。

---

## 1. 项目概述

一个以情侣双人关系为核心的数据与交互系统，面向“长期异地、共同成长”的使用场景。  
系统不仅提供基础的记录功能（旅行、心愿、成就），更具备多模态生成能力（定制剧本、图像、视频、词汇卡），并通过可编排的 AI Pipeline 贯通数据流与业务流。

### 核心价值
- **关系维度**：提升异地关系中的陪伴连续性与互动参与感。
- **能力维度**：将记忆资产转化为个性化学习资产（未来排练室）。
- **工程维度**：采用模块化、多模型选型可切换的 AI 基建，支持系统快速迭代与鲁棒运行。

---

## 2. 核心技术亮点

### 2.1 LangGraph 多智能体编排（未来排练室）

项目在 `rehearsal_backend` 模块中实现了基于 LangGraph 的有向无环图（DAG）编排原型，其典型流水线流程为：

`START -> perception -> fusion -> script -> media -> END`

#### 智能体 (Agent) 节点拆分策略
- **Perception 感知层（并发执行）**
  - **文本解析 Agent**：识别用户学习目标与语义意图。
  - **语音线索 Agent**：抽取情绪特征与表达节奏信息。
  - **图像场景 Agent**：解析视觉上下文与场景元素。
- **Fusion 融合层**
  - **多模态融合 Agent**：聚合多维特征，生成统一语料与教学导向。
- **Script 生成层**
  - **剧本生成 Agent**：输出包含角色设定与时间戳的结构化 JSON 数据。
- **Media 媒体层（并发执行）**
  - **视频任务 Agent**：发起并调度下游视频生成任务。
  - **词汇卡 Agent**：从剧本中自动提取并构建可学习词条。
- **SOS 旁路系统**
  - 单句发音与跟读辅助，作为独立于主 DAG 的实时低延迟旁路能力。

---

### 2.2 AI-native 数据闭环

系统实现了业务数据向 AI 上下文的原生注入，而非传统的离散 Prompt 拼接：

- **上游数据源**：旅行日志、心愿墙、成就系统等非结构化与结构化记录。
- **中游编排层**：脚本生成、关键帧图像生成、视频渲染任务调度。
- **下游交互层**：剧场视图、角色台词流、互动词汇卡、SOS 跟读辅助。

该闭环机制使得 AI 生成内容具备极强的个体化特征与关系语境一致性，有效抑制模型幻觉。

---

### 2.3 旅行日志的 AI 图像扩展（Q版生成）

旅行模块支持结构化数据记录与图像多媒体上传，并在此基础上扩展了 Q 版图像生成能力：

- **多模态融合输入**：支持多图参考输入（用户真实图 + 风格参考图）。
- **一致性约束**：通过固定风格约束 prompt，保持线条小狗 IP 角色的造型一致性。
- **资产沉淀**：输出内容直接落库，用于前端回忆时间线展示及后续多媒体学习素材的生成。

从系统架构视角，旅行模块不仅是关系数据的存储层，更是整个 AI 生成链路的高质量语义数据源。

---

## 3. 技术栈

- **Web 框架**：Next.js（App Router）+ React + TypeScript
- **样式系统**：Tailwind CSS
- **状态管理**：Zustand（含状态持久化）
- **后端接口层**：Next.js Route Handlers（BFF，Backend for Frontend）
- **数据与鉴权基础设施**：Supabase（PostgreSQL + Auth + Storage）
- **AI 能力层**：
  - OpenAI-compatible 协议（脚本及文本类生成）
  - 火山引擎（Q 版图像生成、视频流能力接入）
  - Provider 抽象层（支持 mock / http 快速切换）

---

## 4. 安全与数据边界

- 以 `couple_id` 作为核心数据隔离边界，保障多租户场景下的数据安全。
- API 接口层执行严格的工作区上下文校验（例如：情侣绑定关系上下文、Bearer Token 用户身份校验）。
- 服务端高权限或敏感操作统一通过 `SUPABASE_SERVICE_ROLE_KEY` 闭环执行，防止越权。
- 前端环境严格限制变量暴露，仅允许 `NEXT_PUBLIC_*` 级别的环境变量透出。

---

## 5. 关键业务模块

### 情侣空间（Onboarding）
- 匿名进入、角色绑定设置。
- 支持邀请码机制建房与加入。
- 双方配对握手成功后，解锁并进入主业务流程。

### 主页（关系状态可视化）
- 双核心目标进度追踪（下一次见面倒计时 / 异地分离期结束倒计时）。
- 引入与成就积分系统联动的动态正反馈机制。

### 旅行日志（Travel）
- 提供标题、日期、地点、随笔、多图关联的结构化记录表单。
- 采用时间线 (Timeline) 视图展示，深度集成对象存储服务。
- 触发 AI Q 版图像生成扩展流程。

### 心愿墙（Wishes）
- 支持心愿的 CRUD（新建 / 完成 / 删除）操作。
- 数据状态与地理位置地图、旅行时间线模块深度联动。

### 成就系统（Achievements）
- 双列任务板设计（自我任务 / 伴侣任务）。
- 支持高频状态同步、专注模式计时，以及双向互动反馈。

### 未来排练室（Learning）
- 剧本、关键帧、视频流、交互词汇卡的协同 UI 展示。
- 串联 脚本生成 -> 图像渲染 -> 视频任务下发 -> 异步轮询的完整 Pipeline。
- 集成 SOS 跟读与语音辅助功能。

---

## 6. 关键 API（节选）

系统接口采用 RESTful 风格与微服务思想设计：

**Couple (关系与鉴权)**
- `POST /api/couple/create-room`
- `POST /api/couple/join`
- `POST /api/couple/leave`
- `GET  /api/couple/me`
- `POST /api/couple/set-role`

**Travel / Wishes (业务数据流)**
- `GET/POST /api/travel-logs`
- `GET/PUT  /api/travel-logs/[id]`
- `POST     /api/travel-logs/upload-photo`
- `GET/POST /api/wishes`
- `GET/PUT  /api/wishes/[id]`

**Achievements (状态同步)**
- `POST /api/achievements/bootstrap`
- `GET  /api/achievements/tasks`
- `POST /api/achievements/presence`
- `GET  /api/achievements/bond-summary`
- `GET  /api/achievements/whisper/read`

**AI Pipeline (多智能体与任务调度)**
- `POST /api/pipeline/script`
- `POST /api/pipeline/image`
- `POST /api/pipeline/video/start`
- `GET  /api/pipeline/jobs/[id]`
- `GET  /api/rehearsal`
- `POST /api/rehearsal/sos`
- `POST /api/generate-q-avatar`

---

## 7. 快速开始

### 1) 安装依赖
```bash
cd puppy-journey
pnpm install
```

### 2) 配置环境变量
在 `puppy-journey` 根目录下创建 `.env.local` 文件。

**最低必需配置：**
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

**AI 模块可选配置：**
```env
PIPELINE_SCRIPT_LLM_API_KEY=xxx
PIPELINE_SCRIPT_LLM_BASE_URL=xxx
PIPELINE_SCRIPT_LLM_MODEL=xxx # 或 PIPELINE_SCRIPT_LLM_ENDPOINT_ID

VOLCENGINE_Q_AVATAR_API_KEY=xxx
VOLCENGINE_Q_AVATAR_ENDPOINT_ID=xxx

PIPELINE_VIDEO_API_KEY=xxx
PIPELINE_VIDEO_BASE_URL=xxx
PIPELINE_VIDEO_MODEL=xxx
PIPELINE_VIDEO_PROVIDER=xxx
```

### 3) 本地运行
```bash
pnpm dev
```
启动后，默认访问地址为：`http://localhost:3000`

---

## 8. 部署说明（Vercel）

本项目仓库为 Monorepo 结构，在 Vercel 导入时请将 **Root Directory** 设置为 `puppy-journey`。

- **Framework Preset** 选择 `Next.js`。
- 请务必在 Vercel 项目设置的 **Environment Variables** 面板中配置全量环境变量（在首次部署前，优先保证 Supabase 的三项核心密钥配置准确）。
