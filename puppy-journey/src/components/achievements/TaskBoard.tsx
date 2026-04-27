"use client";

import { cn } from "@/lib/utils";
import { TaskCard } from "./TaskCard";
import type { AchievementTask } from "./types";

type Props = {
  tasks: AchievementTask[];
  onTaskBodyClick: (task: AchievementTask) => void;
  onDeleteTask: (taskId: string) => Promise<void>;
  /**
   * 成就页双栏布局中每栏较窄，用单列瀑布；全宽混排时用双列 columns。
   */
  singleColumn?: boolean;
  className?: string;
};

/**
 * 手账风：CSS columns 瀑布流；默认可在全宽下两列混排，singleColumn 时固定单列。
 */
export function TaskBoard({ tasks, onTaskBodyClick, onDeleteTask, singleColumn, className }: Props) {
  return (
    <div className={cn("mx-auto w-full max-w-5xl", singleColumn && "max-w-none", className)}>
      <div
        className={cn(
          "columns-1 gap-4 space-y-4 md:gap-6 md:space-y-6",
          !singleColumn && "sm:columns-2",
        )}
      >
        {tasks.map((task) => (
          <div key={task.id} className="mb-4 break-inside-avoid md:mb-6">
            <TaskCard
              task={task}
              onBodyClick={() => onTaskBodyClick(task)}
              onDelete={onDeleteTask}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
