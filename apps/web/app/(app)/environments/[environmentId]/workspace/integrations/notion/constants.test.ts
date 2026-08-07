import { describe, expect, test } from "vitest";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import { TYPE_MAPPING } from "./constants";

describe("TYPE_MAPPING", () => {
  test("declares accepted Notion column types for every element type", () => {
    // The mapping UI offers every element of the selected survey and then dereferences this map by the
    // element's type with no fallback, so an element type that is absent here is a TypeError in the UI
    // rather than a degraded experience.
    expect([...Object.keys(TYPE_MAPPING)].sort()).toEqual([...Object.values(TSurveyElementTypeEnum)].sort());

    const typesWithoutColumns = Object.entries(TYPE_MAPPING)
      .filter(([, columns]) => columns.length === 0)
      .map(([type]) => type);
    expect(typesWithoutColumns).toEqual([]);
  });

  test("maps a slider onto a Notion number column, like the other numeric element types", () => {
    // A slider answer is a single number, so it accepts exactly the columns the other numeric types accept.
    expect(TYPE_MAPPING[TSurveyElementTypeEnum.Slider]).toEqual(["number"]);
    expect(TYPE_MAPPING[TSurveyElementTypeEnum.OpinionScale]).toEqual(["number"]);
    expect(TYPE_MAPPING[TSurveyElementTypeEnum.Rating]).toEqual(["number"]);
    expect(TYPE_MAPPING[TSurveyElementTypeEnum.NPS]).toEqual(["number"]);
  });

  test("answers the compatibility questions the mapping UI asks about a slider", () => {
    const acceptedColumns = TYPE_MAPPING[TSurveyElementTypeEnum.Slider];

    // MappingRow: a number column is a valid pairing, any other column is reported as a mapping error.
    expect(acceptedColumns.includes("number")).toBe(true);
    expect(acceptedColumns.includes("rich_text")).toBe(false);
    // MappingErrorMessage: the column type the author is told to use instead.
    expect(acceptedColumns.join(" ,")).toBe("number");
  });
});
