import type { AchievementTask, UserStatusPair } from "./types";
import { ROLE_INFO } from "@/lib/userRole";

export const initialUserStatus: UserStatusPair = {
  me: {
    isFocusing: false,
    statusText: "今天也要加油呀",
    avatar: ROLE_INFO.white_dog.emoji,
    roleAvatarUrl: ROLE_INFO.white_dog.avatarSrc,
    statusIcon: null,
    unreadWhispers: 0,
    lastWhisperReceived: null,
  },
  partner: {
    isFocusing: false,
    statusText: "等你一起散步",
    avatar: ROLE_INFO.yellow_dog.emoji,
    roleAvatarUrl: ROLE_INFO.yellow_dog.avatarSrc,
    statusIcon: null,
    unreadWhispers: 0,
    lastWhisperReceived: null,
  },
};

const now = Date.now();
export const initialTasks: AchievementTask[] = [
  {
    id: "t1",
    owner: "me",
    title: "读完一章《亲密关系》",
    score: 10,
    createdAt: new Date(now - 3 * 3600_000).toISOString(),
    blindBox: {
      isAttached: true,
      isOpened: false,
      voucher: "milktea",
      voiceUrl: null,
    },
  },
  {
    id: "t2",
    owner: "me",
    title: "晨跑 20 分钟",
    score: 5,
    createdAt: new Date(now - 2 * 3600_000).toISOString(),
    blindBox: { isAttached: false, isOpened: false, voucher: null, voiceUrl: null },
  },
  {
    id: "t3",
    owner: "partner",
    title: "学会一道新菜",
    score: 10,
    createdAt: new Date(now - 3600_000).toISOString(),
    blindBox: { isAttached: false, isOpened: false, voucher: null, voiceUrl: null },
  },
  {
    id: "t4",
    owner: "partner",
    title: "整理旅行照片",
    score: 5,
    createdAt: new Date(now - 4 * 3600_000).toISOString(),
    blindBox: {
      isAttached: true,
      isOpened: false,
      voucher: "film",
      voiceUrl: null,
    },
  },
];
