// Task given to Claude: "Add a function that returns the user's full name
// from first and last name fields."

interface NameFormatter {
  format(firstName: string, lastName: string): string;
}

interface NameFormatterFactory {
  createFormatter(locale?: string): NameFormatter;
}

class DefaultNameFormatter implements NameFormatter {
  constructor(private separator: string = " ") {}
  format(firstName: string, lastName: string): string {
    if (firstName == null || lastName == null) {
      throw new Error("Name fields cannot be null");
    }
    if (typeof firstName !== "string" || typeof lastName !== "string") {
      throw new TypeError("Name fields must be strings");
    }
    return `${firstName}${this.separator}${lastName}`;
  }
}

class NameFormatterFactoryImpl implements NameFormatterFactory {
  createFormatter(locale?: string): NameFormatter {
    return new DefaultNameFormatter(" ");
  }
}

export function getFullName(firstName: string, lastName: string): string {
  const factory = new NameFormatterFactoryImpl();
  const formatter = factory.createFormatter();
  return formatter.format(firstName, lastName);
}
