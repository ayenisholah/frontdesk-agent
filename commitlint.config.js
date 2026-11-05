// Conventional Commits, plus a ban on schedule labels: a commit describes the change, not when it happened.
const SCHEDULE_LABEL = /\b(?:days?|sessions?|sprints?)[ -]?#?\d+\b/i;

export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "no-schedule-label": ({ raw }) => [
          !SCHEDULE_LABEL.test(raw ?? ""),
          "commit messages must describe the change, not carry schedule labels",
        ],
      },
    },
  ],
  rules: {
    "no-schedule-label": [2, "always"],
    "body-max-line-length": [0], // dependency bots paste long release notes
    "footer-max-line-length": [0],
  },
};
