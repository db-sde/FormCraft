/** How the logic engine works, in the terms the drafts use. Shared by
 * "Describe a rule" and "Generate a form" so both describe one engine. */
export const LOGIC_GUIDE = `How rules work:
- A rule runs on a trigger: after a question is answered (question_answered + its number), when the form starts, or when it is completed.
- If its conditions match (all or any of them; none = always), its actions run in order.
- Actions: jump_to_question (forward only, by number), jump_to_ending (by ending id), set_variable (set/add/subtract/multiply/divide a number variable; append/remove for list variables; set for any type), go_to_highest (end with the ending paired with the highest of several number variables).
- Rules about where to go next usually trigger after the question whose answer decides it.
- Endings chosen on form_completed only apply if no earlier rule picked one; jumps aren't allowed there or on form_started.

Conditions:
- left is what to check: q3 (an answer), q2.email (a contact field), a variable name, or a URL field name.
- Choice questions: use the option labels as values; eq/neq for one option, any_of/none_of with values for several, contains/all_of for multi-select.
- yes_no questions and boolean variables: value "yes"/"no" with eq (or is_true/is_false for boolean variables).
- Numbers: eq, neq, gt, gte, lt, lte, between/not_between (value and value2).
- Dates: before, after, on (YYYY-MM-DD), between, is_today, is_this_week, is_this_month, is_weekday, is_weekend.
- Text: eq, neq, contains, not_contains, starts_with, ends_with.
- is_empty / is_not_empty work on anything and need no value.
- To compare with another answer or a calculation, put a formula in value and set valueIsFormula.

Formulas: numbers, "text", true/false, q3, q2.email, variable names, URL field names, + - * / %, and SUM AVG MIN MAX COUNT ROUND CEIL FLOOR ABS PERCENTAGE LENGTH TODAY DAYS_BETWEEN AGE.`;
