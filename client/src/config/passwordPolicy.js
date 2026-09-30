export const PASSWORD_MIN_LENGTH = 10;
export function passwordHints(value) {
  return [
    { label: "10+ characters", met: value.length >= PASSWORD_MIN_LENGTH },
    { label: "Mixed case", met: /[a-z]/.test(value) && /[A-Z]/.test(value) },
    { label: "Number", met: /\d/.test(value) },
    { label: "Symbol", met: /[^a-zA-Z0-9]/.test(value) },
  ];
}