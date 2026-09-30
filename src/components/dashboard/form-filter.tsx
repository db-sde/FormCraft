"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "__all__";

/** Narrows a list to one form via `?form=<id>`. */
export function FormFilter({
  forms,
  value,
}: {
  forms: { id: string; title: string }[];
  value?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) =>
        router.push(next === ALL ? pathname : `${pathname}?form=${next}`)
      }
    >
      <SelectTrigger className="w-full sm:w-64" aria-label="Filter by form">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All forms</SelectItem>
        {forms.map((form) => (
          <SelectItem key={form.id} value={form.id}>
            {form.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
