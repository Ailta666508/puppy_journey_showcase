type JobRow = {
  author_id?: string | null;
  couple_id?: string | null;
};

export function rehearsalJobOwnedByContext(
  row: JobRow,
  profileId: string,
  coupleId: string,
): boolean {
  if (row.couple_id != null && row.couple_id !== "" && row.couple_id !== coupleId) {
    return false;
  }
  if (row.author_id != null && row.author_id !== "") {
    return row.author_id === profileId;
  }
  return false;
}
