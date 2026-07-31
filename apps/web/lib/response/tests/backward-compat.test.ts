/**
 * Epic 4.2 — Migration Safety: Backward-Compatibility Test Suite
 *
 * Validates that the expanded ZSurveyElement discriminated union (now 17 members,
 * previously 15 — includes new OpinionScale and Payment element types) is non-breaking
 * and additive-only. Also confirms that existing surveys parse correctly through the
 * updated ZSurvey schema with the legacy question-based model.
 *
 * This file uses pure Zod schema validation — no Prisma, no I/O, no mocks.
 */
import { describe, expect, test } from "vitest";
import { TSurveyElementTypeEnum, ZSurveyElement } from "@formbricks/types/surveys/elements";
import { ZSurvey } from "@formbricks/types/surveys/types";

// ---------------------------------------------------------------------------
// Helper: Toggle input configuration for address/contactInfo element fields
// ---------------------------------------------------------------------------
const createToggleInputConfig = (placeholder: string) => ({
  show: true,
  required: false,
  placeholder: { default: placeholder },
});

// ---------------------------------------------------------------------------
// Helper: Creates a valid minimal element fixture with base fields
// ---------------------------------------------------------------------------
const createMinimalElement = (
  type: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: `test-element-${type}`,
  type,
  headline: { default: "Test headline" },
  required: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Fixtures — one per element type, each satisfying ZSurveyElement.safeParse()
// ---------------------------------------------------------------------------

/** 15 legacy element types that existed before the Sprint 1-3 expansion */
const LEGACY_ELEMENT_TYPES = [
  "openText",
  "consent",
  "multipleChoiceSingle",
  "multipleChoiceMulti",
  "nps",
  "cta",
  "rating",
  "pictureSelection",
  "date",
  "fileUpload",
  "cal",
  "matrix",
  "address",
  "ranking",
  "contactInfo",
] as const;

/** 2 new element types added during Sprints 1-3 */
const NEW_ELEMENT_TYPES = ["opinionScale", "payment"] as const;

/** All 17 element type keys for iteration */
const ALL_ELEMENT_TYPES = [...LEGACY_ELEMENT_TYPES, ...NEW_ELEMENT_TYPES] as const;

/**
 * Element fixtures keyed by type string.
 * Each fixture is a complete, valid object that passes ZSurveyElement.safeParse().
 */
const elementFixtures: Record<string, Record<string, unknown>> = {
  // --- Legacy types (15) ---------------------------------------------------

  openText: createMinimalElement("openText"),

  consent: createMinimalElement("consent", {
    label: { default: "I consent" },
  }),

  multipleChoiceSingle: createMinimalElement("multipleChoiceSingle", {
    choices: [
      { id: "c1", label: { default: "Choice 1" } },
      { id: "c2", label: { default: "Choice 2" } },
    ],
    shuffleOption: "none",
  }),

  multipleChoiceMulti: createMinimalElement("multipleChoiceMulti", {
    choices: [
      { id: "c1", label: { default: "Choice 1" } },
      { id: "c2", label: { default: "Choice 2" } },
    ],
    shuffleOption: "none",
  }),

  nps: createMinimalElement("nps", {
    lowerLabel: { default: "Not likely" },
    upperLabel: { default: "Very likely" },
  }),

  cta: createMinimalElement("cta", {
    buttonExternal: false,
  }),

  rating: createMinimalElement("rating", {
    range: 5,
    scale: "number",
  }),

  pictureSelection: createMinimalElement("pictureSelection", {
    choices: [
      { id: "p1", imageUrl: "https://example.com/img1.png" },
      { id: "p2", imageUrl: "https://example.com/img2.png" },
    ],
    allowMulti: false,
  }),

  date: createMinimalElement("date", {
    format: "M-d-y",
  }),

  fileUpload: createMinimalElement("fileUpload", {
    allowMultipleFiles: false,
  }),

  cal: createMinimalElement("cal", {
    calUserName: "test",
    calHost: "cal.com",
  }),

  matrix: createMinimalElement("matrix", {
    rows: [{ id: "r1", label: { default: "Row 1" } }],
    columns: [{ id: "c1", label: { default: "Col 1" } }],
  }),

  address: createMinimalElement("address", {
    addressLine1: createToggleInputConfig("Address Line 1"),
    addressLine2: createToggleInputConfig("Address Line 2"),
    city: createToggleInputConfig("City"),
    state: createToggleInputConfig("State"),
    zip: createToggleInputConfig("ZIP"),
    country: createToggleInputConfig("Country"),
  }),

  ranking: createMinimalElement("ranking", {
    choices: [
      { id: "rk1", label: { default: "Item 1" } },
      { id: "rk2", label: { default: "Item 2" } },
    ],
  }),

  contactInfo: createMinimalElement("contactInfo", {
    firstName: createToggleInputConfig("First name"),
    lastName: createToggleInputConfig("Last name"),
    email: createToggleInputConfig("Email"),
    phone: createToggleInputConfig("Phone"),
    company: createToggleInputConfig("Company"),
  }),

  // --- New types added in Sprints 1-3 (2) ---------------------------------

  opinionScale: createMinimalElement("opinionScale", {
    scaleRange: 5,
    visualStyle: "number",
  }),

  payment: createMinimalElement("payment", {
    currency: "usd",
    amount: 1000,
    stripeIntegration: { publicKey: "pk_test_123" },
  }),
};

// ---------------------------------------------------------------------------
// ZSurvey full-survey fixture using legacy questions array
// Uses CUID2-compatible IDs and satisfies all ZSurvey superRefine constraints
// ---------------------------------------------------------------------------

const legacySurveyFixture = {
  id: "clrqm2x820000v9jz9iqp5o5c",
  createdAt: new Date("2024-01-15T00:00:00.000Z"),
  updatedAt: new Date("2024-01-15T00:00:00.000Z"),
  name: "Backward Compat Legacy Survey",
  type: "link" as const,
  environmentId: "clrqm2x820002v9jz9iqp5o5c",
  createdBy: null,
  status: "draft" as const,
  displayOption: "displayOnce" as const,
  autoClose: null,
  triggers: [],
  recontactDays: null,
  displayLimit: null,
  welcomeCard: { enabled: false },
  questions: [
    {
      id: "q1-open-text",
      type: "openText",
      headline: { default: "What is your feedback?" },
      required: false,
    },
    {
      id: "q2-multiple-choice",
      type: "multipleChoiceSingle",
      headline: { default: "How did you hear about us?" },
      required: true,
      choices: [
        { id: "mc1", label: { default: "Google Search" } },
        { id: "mc2", label: { default: "Social Media" } },
      ],
      shuffleOption: "none",
    },
    {
      id: "q3-nps",
      type: "nps",
      headline: { default: "How likely are you to recommend us?" },
      required: false,
      lowerLabel: { default: "Not at all likely" },
      upperLabel: { default: "Extremely likely" },
    },
    {
      id: "q4-rating",
      type: "rating",
      headline: { default: "Rate your experience" },
      required: false,
      scale: "star",
      range: 5,
    },
    {
      id: "q5-consent",
      type: "consent",
      headline: { default: "Privacy consent" },
      required: true,
      label: { default: "I agree to the terms" },
    },
  ],
  blocks: [],
  endings: [
    {
      type: "endScreen" as const,
      id: "clrqm2x820001v9jz9iqp5o5c",
      headline: { default: "Thank you!" },
      subheader: { default: "We appreciate your feedback." },
    },
  ],
  hiddenFields: { enabled: false },
  variables: [],
  followUps: [],
  delay: 0,
  autoComplete: null,
  projectOverwrites: null,
  styling: null,
  showLanguageSwitch: null,
  surveyClosedMessage: null,
  segment: null,
  singleUse: null,
  isVerifyEmailEnabled: false,
  recaptcha: null,
  isSingleResponsePerEmailEnabled: false,
  isBackButtonHidden: false,
  isCaptureIpEnabled: false,
  pin: null,
  displayPercentage: null,
  languages: [],
  metadata: {},
  slug: null,
};

// ===========================================================================
// TEST SUITE
// ===========================================================================

describe("Epic 4.2 — Backward Compatibility Tests", () => {
  // -------------------------------------------------------------------------
  // Phase 3 — ZSurveyElement individual element parsing
  // -------------------------------------------------------------------------
  describe("ZSurveyElement individual element parsing", () => {
    test("parses openText element correctly", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.openText);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.OpenText);
      }
    });

    test("parses consent element correctly", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.consent);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.Consent);
      }
    });

    test("parses multipleChoiceSingle element correctly", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.multipleChoiceSingle);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.MultipleChoiceSingle);
      }
    });

    test("parses multipleChoiceMulti element correctly", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.multipleChoiceMulti);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.MultipleChoiceMulti);
      }
    });

    test("parses nps element correctly", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.nps);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.NPS);
      }
    });

    test("parses cta element correctly", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.cta);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.CTA);
      }
    });

    test("parses rating element correctly", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.rating);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.Rating);
      }
    });

    test("parses pictureSelection element correctly", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.pictureSelection);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.PictureSelection);
      }
    });

    test("parses date element correctly", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.date);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.Date);
      }
    });

    test("parses fileUpload element correctly", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.fileUpload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.FileUpload);
      }
    });

    test("parses cal element correctly", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.cal);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.Cal);
      }
    });

    test("parses matrix element correctly", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.matrix);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.Matrix);
      }
    });

    test("parses address element correctly", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.address);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.Address);
      }
    });

    test("parses ranking element correctly", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.ranking);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.Ranking);
      }
    });

    test("parses contactInfo element correctly", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.contactInfo);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.ContactInfo);
      }
    });

    // --- NEW element types added in Sprints 1-3 ---

    test("parses opinionScale element correctly (NEW)", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.opinionScale);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.OpinionScale);
      }
    });

    test("parses payment element correctly (NEW)", () => {
      const result = ZSurveyElement.safeParse(elementFixtures.payment);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe(TSurveyElementTypeEnum.Payment);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Phase 4 — TSurveyElementTypeEnum completeness
  // -------------------------------------------------------------------------
  describe("TSurveyElementTypeEnum completeness", () => {
    test("enum contains exactly 18 members", () => {
      expect(Object.values(TSurveyElementTypeEnum).length).toBe(18);
    });

    test("all 15 legacy types are present in the enum", () => {
      const enumValues = Object.values(TSurveyElementTypeEnum);
      const expectedLegacyValues = [
        "fileUpload",
        "openText",
        "multipleChoiceSingle",
        "multipleChoiceMulti",
        "nps",
        "cta",
        "rating",
        "consent",
        "pictureSelection",
        "cal",
        "date",
        "matrix",
        "address",
        "ranking",
        "contactInfo",
      ];

      for (const value of expectedLegacyValues) {
        expect(enumValues).toContain(value);
      }
    });

    test("both new types (payment, opinionScale) are present in the enum", () => {
      const enumValues = Object.values(TSurveyElementTypeEnum);
      expect(enumValues).toContain("payment");
      expect(enumValues).toContain("opinionScale");
    });

    test("enum keys map to expected string literal values", () => {
      expect(TSurveyElementTypeEnum.FileUpload).toBe("fileUpload");
      expect(TSurveyElementTypeEnum.OpenText).toBe("openText");
      expect(TSurveyElementTypeEnum.MultipleChoiceSingle).toBe("multipleChoiceSingle");
      expect(TSurveyElementTypeEnum.MultipleChoiceMulti).toBe("multipleChoiceMulti");
      expect(TSurveyElementTypeEnum.NPS).toBe("nps");
      expect(TSurveyElementTypeEnum.CTA).toBe("cta");
      expect(TSurveyElementTypeEnum.Rating).toBe("rating");
      expect(TSurveyElementTypeEnum.Consent).toBe("consent");
      expect(TSurveyElementTypeEnum.PictureSelection).toBe("pictureSelection");
      expect(TSurveyElementTypeEnum.Cal).toBe("cal");
      expect(TSurveyElementTypeEnum.Date).toBe("date");
      expect(TSurveyElementTypeEnum.Matrix).toBe("matrix");
      expect(TSurveyElementTypeEnum.Address).toBe("address");
      expect(TSurveyElementTypeEnum.Ranking).toBe("ranking");
      expect(TSurveyElementTypeEnum.ContactInfo).toBe("contactInfo");
      expect(TSurveyElementTypeEnum.Payment).toBe("payment");
      expect(TSurveyElementTypeEnum.OpinionScale).toBe("opinionScale");
      expect(TSurveyElementTypeEnum.Slider).toBe("slider");
    });
  });

  // -------------------------------------------------------------------------
  // Phase 5 — ZSurveyElement union is additive-only (non-breaking)
  // -------------------------------------------------------------------------
  describe("ZSurveyElement union is additive-only (non-breaking)", () => {
    test("rejects element with invalid type", () => {
      const invalidElement = createMinimalElement("nonExistentType");
      const result = ZSurveyElement.safeParse(invalidElement);
      expect(result.success).toBe(false);
    });

    test("rejects element missing required headline field", () => {
      const missingHeadline = {
        id: "test-missing-headline",
        type: "openText",
        required: false,
        // headline is intentionally omitted
      };
      const result = ZSurveyElement.safeParse(missingHeadline);
      expect(result.success).toBe(false);
    });

    test("rejects element missing required id field", () => {
      const missingId = {
        type: "openText",
        headline: { default: "No id element" },
        required: false,
      };
      const result = ZSurveyElement.safeParse(missingId);
      expect(result.success).toBe(false);
    });

    test("rejects element with invalid id (contains spaces)", () => {
      const invalidId = createMinimalElement("openText", {
        id: "invalid id with spaces",
      });
      const result = ZSurveyElement.safeParse(invalidId);
      expect(result.success).toBe(false);
    });

    test.each(LEGACY_ELEMENT_TYPES)("all 15 legacy types parse successfully — %s", (elementType) => {
      const fixture = elementFixtures[elementType];
      expect(fixture).toBeDefined();
      const result = ZSurveyElement.safeParse(fixture);
      if (!result.success) {
        // Surface errors for debugging if the test fails
        throw new Error(
          `Legacy element "${elementType}" failed to parse: ${JSON.stringify(result.error.issues, null, 2)}`
        );
      }
      expect(result.success).toBe(true);
    });

    test.each(NEW_ELEMENT_TYPES)("new element types parse successfully — %s", (elementType) => {
      const fixture = elementFixtures[elementType];
      expect(fixture).toBeDefined();
      const result = ZSurveyElement.safeParse(fixture);
      if (!result.success) {
        throw new Error(
          `New element "${elementType}" failed to parse: ${JSON.stringify(result.error.issues, null, 2)}`
        );
      }
      expect(result.success).toBe(true);
    });

    test("all 17 element type fixtures produce the correct type discriminator", () => {
      for (const elementType of ALL_ELEMENT_TYPES) {
        const fixture = elementFixtures[elementType];
        const result = ZSurveyElement.safeParse(fixture);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.type).toBe(elementType);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Phase 6 — ZSurvey full survey parsing with legacy questions
  // -------------------------------------------------------------------------
  describe("ZSurvey full survey parsing with legacy questions", () => {
    test("parses a complete legacy survey with multiple question types", () => {
      const result = ZSurvey.safeParse(legacySurveyFixture);
      if (!result.success) {
        // Surface detailed Zod issues for debugging
        const issuesSummary = result.error.issues.map(
          (issue) => `[${issue.path.join(".")}] ${issue.message}`
        );
        throw new Error(`ZSurvey legacy fixture parse failed:\n${issuesSummary.join("\n")}`);
      }
      expect(result.success).toBe(true);
    });

    test("parsed legacy survey retains all question types", () => {
      const result = ZSurvey.safeParse(legacySurveyFixture);
      expect(result.success).toBe(true);
      if (result.success) {
        const questionTypes = result.data.questions.map((q) => q.type);
        expect(questionTypes).toContain("openText");
        expect(questionTypes).toContain("multipleChoiceSingle");
        expect(questionTypes).toContain("nps");
        expect(questionTypes).toContain("rating");
        expect(questionTypes).toContain("consent");
        expect(result.data.questions.length).toBe(5);
      }
    });

    test("rejects survey with duplicate question IDs", () => {
      const duplicateIdSurvey = {
        ...legacySurveyFixture,
        questions: [
          {
            id: "duplicate-id",
            type: "openText",
            headline: { default: "Question 1" },
            required: false,
          },
          {
            id: "duplicate-id",
            type: "openText",
            headline: { default: "Question 2" },
            required: false,
          },
        ],
      };
      const result = ZSurvey.safeParse(duplicateIdSurvey);
      expect(result.success).toBe(false);
    });

    test("rejects survey with duplicate ending IDs", () => {
      const duplicateEndingSurvey = {
        ...legacySurveyFixture,
        endings: [
          {
            type: "endScreen" as const,
            id: "clrqm2x820001v9jz9iqp5o5c",
          },
          {
            type: "endScreen" as const,
            id: "clrqm2x820001v9jz9iqp5o5c",
          },
        ],
      };
      const result = ZSurvey.safeParse(duplicateEndingSurvey);
      expect(result.success).toBe(false);
    });

    test("rejects survey with both questions and populated blocks", () => {
      const bothModelsSurvey = {
        ...legacySurveyFixture,
        blocks: [
          {
            id: "clrqm2x820005v9jz9iqp5o5c",
            elements: [
              {
                id: "block-element-1",
                type: "openText",
                headline: { default: "Block question" },
                required: false,
              },
            ],
            logic: [],
            logicFallback: null,
          },
        ],
      };
      const result = ZSurvey.safeParse(bothModelsSurvey);
      expect(result.success).toBe(false);
    });

    test("parses survey with empty questions and populated blocks", () => {
      // Demonstrates that the blocks-based model is also supported
      const blocksOnlySurvey = {
        ...legacySurveyFixture,
        questions: [],
        blocks: [
          {
            id: "clrqm2x820005v9jz9iqp5o5c",
            name: "Block 1",
            elements: [
              {
                id: "block-element-1",
                type: "openText",
                headline: { default: "Block question" },
                required: false,
              },
            ],
            logic: [],
          },
        ],
      };
      const result = ZSurvey.safeParse(blocksOnlySurvey);
      if (!result.success) {
        const issuesSummary = result.error.issues.map(
          (issue) => `[${issue.path.join(".")}] ${issue.message}`
        );
        throw new Error(`ZSurvey blocks-only fixture parse failed:\n${issuesSummary.join("\n")}`);
      }
      expect(result.success).toBe(true);
    });
  });
});
