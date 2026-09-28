import {
  Hand,
  Type,
  AlignLeft,
  Mail,
  Phone,
  Link as LinkIcon,
  Hash,
  CircleDot,
  CheckSquare,
  ChevronDown,
  ThumbsUp,
  Calendar,
  Star,
  SlidersHorizontal,
  Upload,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { QUESTION_TYPES, type QuestionType } from "@/domains/forms/schema/question-types";

export const QUESTION_TYPE_META: Record<
  QuestionType,
  { label: string; icon: LucideIcon; group: "screen" | "answer" }
> = {
  welcome_screen: { label: "Welcome screen", icon: Hand, group: "screen" },
  short_text: { label: "Short text", icon: Type, group: "answer" },
  long_text: { label: "Long text", icon: AlignLeft, group: "answer" },
  email: { label: "Email", icon: Mail, group: "answer" },
  phone: { label: "Phone", icon: Phone, group: "answer" },
  url: { label: "Website URL", icon: LinkIcon, group: "answer" },
  number: { label: "Number", icon: Hash, group: "answer" },
  single_select: { label: "Multiple choice", icon: CircleDot, group: "answer" },
  multi_select: { label: "Checkboxes", icon: CheckSquare, group: "answer" },
  dropdown: { label: "Dropdown", icon: ChevronDown, group: "answer" },
  yes_no: { label: "Yes / No", icon: ThumbsUp, group: "answer" },
  date: { label: "Date", icon: Calendar, group: "answer" },
  rating: { label: "Rating", icon: Star, group: "answer" },
  opinion_scale: { label: "Opinion scale", icon: SlidersHorizontal, group: "answer" },
  file_upload: { label: "File upload", icon: Upload, group: "answer" },
  statement: { label: "Statement", icon: FileText, group: "screen" },
};

export const ADDABLE_QUESTION_TYPES: QuestionType[] = QUESTION_TYPES.filter(
  (t) => t !== "welcome_screen",
);
