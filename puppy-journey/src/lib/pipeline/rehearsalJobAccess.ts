type JobRow = {
  author_id?: string | null;
  couple_id?: string | null;
};

export function rehearsalJobOwnedByContext(
  row: JobRow,
  profileId: string,
  coupleId: string,
): boolean {
  const rowCoupleId = row.couple_id?.trim();
  if (rowCoupleId) return rowCoupleId === coupleId;

  // Jobs created before couple attribution remain private to their author.
  return row.author_id?.trim() === profileId;
}
