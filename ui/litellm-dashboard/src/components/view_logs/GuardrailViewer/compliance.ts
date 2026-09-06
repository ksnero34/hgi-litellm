export const OUTCOME_PRECEDENCE = {
  passed: 0,
  observed: 1,
  flagged: 2,
  blocked: 3,
} as const;

const actionBadgeClass = {
  passed: "bg-success/15 text-success border border-success/20",
  flagged: "bg-warning/15 text-warning border border-warning/20",
  blocked: "bg-destructive/15 text-destructive border border-destructive/20",
};

export const complianceBadgeClass = {
  ...actionBadgeClass,
  observed: "bg-purple-100 text-purple-700 border border-purple-200",
};
