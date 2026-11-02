import {
  AlignLeft,
  AtSign,
  Calendar,
  CalendarClock,
  CircleDot,
  Clock,
  Grid3x3,
  Images,
  ListOrdered,
  MapPin,
  SeparatorHorizontal,
  Contact,
  DoorOpen,
  Gauge,
  Hash,
  Link2,
  Paperclip,
  PenLine,
  CalendarCheck,
  ShoppingCart,
  Phone,
  Quote,
  SquareCheckBig,
  SquareChevronDown,
  Star,
  TextCursorInput,
  ToggleRight,
  type LucideIcon,
} from "lucide-react";
import { QUESTION_TYPES, type QuestionType } from "@/domains/forms/schema/question-types";

/** Question-type groups, one tint each (Part 1 §1 "Question-type icons"). */
export type QuestionGroup = "Screens" | "Text" | "Choice" | "Scale" | "Other";

export const GROUP_TINT: Record<QuestionGroup, { bg: string; fg: string }> = {
  Screens: { bg: "var(--qt-screens-bg)", fg: "var(--qt-screens-fg)" },
  Text: { bg: "var(--qt-text-bg)", fg: "var(--qt-text-fg)" },
  Choice: { bg: "var(--qt-choice-bg)", fg: "var(--qt-choice-fg)" },
  Scale: { bg: "var(--qt-scale-bg)", fg: "var(--qt-scale-fg)" },
  Other: { bg: "var(--qt-other-bg)", fg: "var(--qt-other-fg)" },
};

type TypeMeta = {
  label: string;
  icon: LucideIcon;
  group: "screen" | "answer";
  tint: QuestionGroup;
  /** One line for the Add question menu. */
  description: string;
};

export const QUESTION_TYPE_META: Record<QuestionType, TypeMeta> = {
  welcome_screen: {
    label: "Welcome screen",
    icon: DoorOpen,
    group: "screen",
    tint: "Screens",
    description: "The first thing people see",
  },
  statement: {
    label: "Statement",
    icon: Quote,
    group: "screen",
    tint: "Screens",
    description: "Text and a continue button",
  },
  short_text: {
    label: "Short text",
    icon: TextCursorInput,
    group: "answer",
    tint: "Text",
    description: "One line",
  },
  long_text: {
    label: "Long text",
    icon: AlignLeft,
    group: "answer",
    tint: "Text",
    description: "Paragraphs, grows as they type",
  },
  email: {
    label: "Email",
    icon: AtSign,
    group: "answer",
    tint: "Text",
    description: "Checked automatically",
  },
  phone: {
    label: "Phone",
    icon: Phone,
    group: "answer",
    tint: "Text",
    description: "With a country code",
  },
  url: {
    label: "Website URL",
    icon: Link2,
    group: "answer",
    tint: "Text",
    description: "Checked automatically",
  },
  number: {
    label: "Number",
    icon: Hash,
    group: "answer",
    tint: "Text",
    description: "Min, max and decimals",
  },
  contact_info: {
    label: "Contact info (lead)",
    icon: Contact,
    group: "answer",
    tint: "Text",
    description: "Name, email and phone in one step",
  },
  single_select: {
    label: "Multiple choice",
    icon: CircleDot,
    group: "answer",
    tint: "Choice",
    description: "Pick one",
  },
  multi_select: {
    label: "Checkboxes",
    icon: SquareCheckBig,
    group: "answer",
    tint: "Choice",
    description: "Pick several",
  },
  dropdown: {
    label: "Dropdown",
    icon: SquareChevronDown,
    group: "answer",
    tint: "Choice",
    description: "For long lists",
  },
  yes_no: {
    label: "Yes / No",
    icon: ToggleRight,
    group: "answer",
    tint: "Choice",
    description: "Two big buttons",
  },
  date: {
    label: "Date",
    icon: Calendar,
    group: "answer",
    tint: "Other",
    description: "With earliest and latest",
  },
  rating: {
    label: "Rating",
    icon: Star,
    group: "answer",
    tint: "Scale",
    description: "5 or 10 stars",
  },
  opinion_scale: {
    label: "Opinion scale",
    icon: Gauge,
    group: "answer",
    tint: "Scale",
    description: "Numbered cells with labels",
  },
  file_upload: {
    label: "File upload",
    icon: Paperclip,
    group: "answer",
    tint: "Other",
    description: "Images and PDFs",
  },
  page_break: {
    label: "Page break",
    icon: SeparatorHorizontal,
    group: "screen",
    tint: "Screens",
    description: "Starts a new page (classic layout)",
  },
  time: {
    label: "Time",
    icon: Clock,
    group: "answer",
    tint: "Other",
    description: "12 or 24 hour, with steps",
  },
  datetime: {
    label: "Date & time",
    icon: CalendarClock,
    group: "answer",
    tint: "Other",
    description: "A moment, with its time zone",
  },
  address: {
    label: "Address",
    icon: MapPin,
    group: "answer",
    tint: "Text",
    description: "Street, city, postcode, country",
  },
  ranking: {
    label: "Ranking",
    icon: ListOrdered,
    group: "answer",
    tint: "Choice",
    description: "Put options in order",
  },
  matrix: {
    label: "Matrix",
    icon: Grid3x3,
    group: "answer",
    tint: "Choice",
    description: "Rows rated on the same columns",
  },
  signature: {
    label: "Signature",
    icon: PenLine,
    group: "answer",
    tint: "Other",
    description: "Draw or type a signature",
  },
  products: {
    label: "Products",
    icon: ShoppingCart,
    group: "answer",
    tint: "Other",
    description: "Items, prices and a total",
  },
  booking: {
    label: "Booking",
    icon: CalendarCheck,
    group: "answer",
    tint: "Other",
    description: "Pick a free time from your calendar",
  },
};

/** What the Add question menu can add: every type, plus "Picture
 * choice" — a multiple-choice question shown as image cards (F-12). */
export type AddKind = QuestionType | "picture_choice";

export const ADD_KIND_META: Record<AddKind, TypeMeta> = {
  ...QUESTION_TYPE_META,
  picture_choice: {
    label: "Picture choice",
    icon: Images,
    group: "answer",
    tint: "Choice",
    description: "Options with images",
  },
};

export const ADDABLE_QUESTION_TYPES: QuestionType[] = QUESTION_TYPES.filter(
  (t) => t !== "welcome_screen",
);

/** The Add question menu's columns (Part 4). */
export const ADD_GROUPS: { name: string; types: AddKind[] }[] = [
  { name: "Screens", types: ["welcome_screen", "statement", "page_break"] },
  {
    name: "Text",
    types: [
      "short_text",
      "long_text",
      "email",
      "phone",
      "url",
      "number",
      "contact_info",
      "address",
    ],
  },
  {
    name: "Choice",
    types: [
      "single_select",
      "multi_select",
      "picture_choice",
      "dropdown",
      "yes_no",
      "ranking",
      "matrix",
    ],
  },
  {
    name: "Scale & other",
    types: [
      "rating",
      "opinion_scale",
      "date",
      "time",
      "datetime",
      "file_upload",
      "signature",
      "products",
      "booking",
    ],
  },
];

/** A question type's icon on its group's tinted tile. */
export function TypeTile({
  type,
  size = 24,
  bordered = true,
  className,
}: {
  type: AddKind;
  size?: 20 | 22 | 24 | 30 | 34;
  /** The canvas chip draws the tile without its ink outline. */
  bordered?: boolean;
  className?: string;
}) {
  const meta = ADD_KIND_META[type];
  const Icon = meta.icon;
  const tint = GROUP_TINT[meta.tint];
  const icon = size >= 34 ? 17 : size >= 30 ? 15 : size >= 24 ? 13 : 12;
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center ${bordered ? "border-ink border-[1.5px]" : ""} ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        borderRadius: size >= 30 ? (size >= 34 ? 8 : 7) : size >= 24 ? 6 : 5,
        background: tint.bg,
        color: tint.fg,
      }}
    >
      <Icon style={{ width: icon, height: icon }} strokeWidth={1.75} />
    </span>
  );
}
