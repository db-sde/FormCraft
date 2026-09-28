"use client";

import { Plus } from "lucide-react";
import type { QuestionType } from "@/domains/forms/schema/question-types";
import { ADDABLE_QUESTION_TYPES, QUESTION_TYPE_META } from "./question-meta";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AddQuestionMenu({ onAdd }: { onAdd: (type: QuestionType) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start">
          <Plus /> Add question
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {ADDABLE_QUESTION_TYPES.map((type) => {
          const meta = QUESTION_TYPE_META[type];
          const Icon = meta.icon;
          return (
            <DropdownMenuItem key={type} onSelect={() => onAdd(type)}>
              <Icon className="text-muted-foreground" />
              {meta.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
