// The character between an industry and a company type in the picker's
// hidden fields ("Industry<SEP>Type"). A control character nobody can
// type, so a name containing "::" or "/" is never split apart. Kept in its
// own file so the client picker can import it without pulling in Prisma.
export const TAG_SEPARATOR = "\u001f";
