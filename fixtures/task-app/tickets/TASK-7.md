# TASK-7: Add-task form — validation and feedback

Users add a task by entering a title and choosing a priority. The form must add
valid tasks to the list and give clear, specific feedback when it can't.

## Acceptance criteria

- **AC1** — Given a non-empty title, when the user clicks **Add**, the task appears
  in the task list.
- **AC2** — Given a **blank or whitespace-only title**, when the user clicks Add,
  the page shows `Title is required` and no task is added to the list.
- **AC3** — Given a title **longer than 80 characters**, when the user clicks Add,
  the page shows `Title must be 80 characters or fewer` and no task is added.

## Notes

Feedback is shown in the status line below the form. Error messages must be
specific. The 80-character limit is a hard boundary: 80 is allowed, 81 is not.
