import { v7 as uuidv7 } from "uuid";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ZTypeformCompatiblePayload } from "@formbricks/database/zod/webhook-payload";
import { TResponse } from "@formbricks/types/responses";
import { TSurveyElementTypeEnum } from "@formbricks/types/surveys/elements";
import { TSurvey } from "@formbricks/types/surveys/types";
import { getElementsFromBlocks } from "@/lib/survey/utils";
import { transformToTypeformPayload } from "./payload-transformer";

// ---------------------------------------------------------------------------
// Module Mocks — hoisted to top by Vitest
// ---------------------------------------------------------------------------

// Mock uuid to generate deterministic event IDs
vi.mock("uuid", () => ({
  v7: vi.fn(),
}));

// Mock getElementsFromBlocks (used internally by the transformer to flatten survey blocks)
vi.mock("@/lib/survey/utils", () => ({
  getElementsFromBlocks: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Comprehensive Mock Fixtures — the 17 element types this fixture covers
// ---------------------------------------------------------------------------

const mockSurvey = {
  id: "survey123",
  name: "Test Comprehensive Survey",
  blocks: [
    {
      id: "block1",
      name: "Block 1",
      elements: [
        {
          id: "q_opentext",
          type: TSurveyElementTypeEnum.OpenText,
          headline: { default: "What is your feedback?" },
          required: true,
          inputType: "text",
          charLimit: 1000,
          subheader: { default: "" },
          placeholder: { default: "" },
        },
        {
          id: "q_mcsingle",
          type: TSurveyElementTypeEnum.MultipleChoiceSingle,
          headline: { default: "Pick one option" },
          required: true,
          choices: [
            { id: "choice_a", label: { default: "Choice A" } },
            { id: "choice_b", label: { default: "Choice B" } },
          ],
          shuffleOption: "none",
          subheader: { default: "" },
        },
        {
          id: "q_mcmulti",
          type: TSurveyElementTypeEnum.MultipleChoiceMulti,
          headline: { default: "Select all that apply" },
          required: true,
          choices: [
            { id: "choice_x", label: { default: "Choice X" } },
            { id: "choice_y", label: { default: "Choice Y" } },
            { id: "choice_z", label: { default: "Choice Z" } },
          ],
          shuffleOption: "none",
          subheader: { default: "" },
        },
        {
          id: "q_rating",
          type: TSurveyElementTypeEnum.Rating,
          headline: { default: "Rate us" },
          required: true,
          range: 5,
          scale: "number",
          subheader: { default: "" },
        },
        {
          id: "q_opinionscale",
          type: TSurveyElementTypeEnum.OpinionScale,
          headline: { default: "On a scale of 1-10" },
          required: true,
          scale: "number",
          range: 10,
          subheader: { default: "" },
        },
        {
          id: "q_nps",
          type: TSurveyElementTypeEnum.NPS,
          headline: { default: "How likely are you to recommend?" },
          required: true,
          lowerLabel: { default: "Not likely" },
          upperLabel: { default: "Very likely" },
          subheader: { default: "" },
        },
        {
          id: "q_consent",
          type: TSurveyElementTypeEnum.Consent,
          headline: { default: "Do you consent?" },
          required: true,
          label: { default: "I agree" },
          subheader: { default: "" },
        },
        {
          id: "q_date",
          type: TSurveyElementTypeEnum.Date,
          headline: { default: "Select a date" },
          required: true,
          format: "M-d-y",
          subheader: { default: "" },
        },
        {
          id: "q_fileupload",
          type: TSurveyElementTypeEnum.FileUpload,
          headline: { default: "Upload a file" },
          required: true,
          allowMultipleFiles: false,
          subheader: { default: "" },
        },
        {
          id: "q_cal",
          type: TSurveyElementTypeEnum.Cal,
          headline: { default: "Book a time" },
          required: false,
          calUserName: "testuser",
          calHost: "cal.com",
          subheader: { default: "" },
        },
        {
          id: "q_matrix",
          type: TSurveyElementTypeEnum.Matrix,
          headline: { default: "Rate each item" },
          required: true,
          rows: [{ default: "Row 1" }, { default: "Row 2" }],
          columns: [{ default: "Col 1" }, { default: "Col 2" }],
          subheader: { default: "" },
        },
        {
          id: "q_address",
          type: TSurveyElementTypeEnum.Address,
          headline: { default: "Enter your address" },
          required: true,
          subheader: { default: "" },
        },
        {
          id: "q_contactinfo",
          type: TSurveyElementTypeEnum.ContactInfo,
          headline: { default: "Contact information" },
          required: true,
          subheader: { default: "" },
        },
        {
          id: "q_ranking",
          type: TSurveyElementTypeEnum.Ranking,
          headline: { default: "Rank these items" },
          required: true,
          choices: [
            { id: "option_1", label: { default: "Option 1" } },
            { id: "option_2", label: { default: "Option 2" } },
            { id: "option_3", label: { default: "Option 3" } },
          ],
          subheader: { default: "" },
        },
        {
          id: "q_pictureselection",
          type: TSurveyElementTypeEnum.PictureSelection,
          headline: { default: "Pick a picture" },
          required: true,
          allowMulti: false,
          choices: [
            { id: "pic_choice_1", imageUrl: "https://img.example.com/1.jpg" },
            { id: "pic_choice_2", imageUrl: "https://img.example.com/2.jpg" },
          ],
          subheader: { default: "" },
        },
        {
          id: "q_payment",
          type: TSurveyElementTypeEnum.Payment,
          headline: { default: "Complete payment" },
          required: true,
          currency: "usd",
          subheader: { default: "" },
        },
        {
          id: "q_cta",
          type: TSurveyElementTypeEnum.CTA,
          headline: { default: "Click to continue" },
          required: false,
          buttonLabel: { default: "Continue" },
          buttonExternal: false,
          subheader: { default: "" },
        },
      ],
    },
  ],
  hiddenFields: {
    enabled: true,
    fieldIds: ["hf_source", "hf_campaign"],
  },
  variables: [
    { id: "var_score", name: "Total Score", type: "number", value: 42 },
    { id: "var_note", name: "Note", type: "text", value: "test note" },
  ],
  type: "app",
  status: "inProgress",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
  autoClose: null,
  triggers: [],
  languages: [],
  styling: {},
  segment: null,
  recontactDays: null,
  autoComplete: null,
  displayOption: "displayOnce",
  displayPercentage: null,
  environmentId: "env1",
  singleUse: null,
  surveyClosedMessage: null,
  pin: null,
} as unknown as TSurvey;

const mockResponse = {
  id: "response123",
  createdAt: new Date("2024-06-15T10:30:00Z"),
  updatedAt: new Date("2024-06-15T10:35:00Z"),
  surveyId: "survey123",
  finished: true,
  endingId: null,
  data: {
    q_opentext: "This is my open text answer",
    q_mcsingle: "choice_a",
    q_mcmulti: ["choice_x", "choice_y"],
    q_rating: 4,
    q_opinionscale: 8,
    q_nps: 9,
    q_consent: "accepted",
    q_date: "2024-06-15",
    q_fileupload: ["https://storage.example.com/file1.pdf"],
    q_cal: "2024-06-20T14:00:00Z",
    q_matrix: { row1: "col1", row2: "col2" },
    q_address: "123 Main St, Springfield, IL 62704",
    q_contactinfo: "john@example.com",
    q_ranking: ["option_1", "option_2", "option_3"],
    q_pictureselection: ["pic_choice_1"],
    q_payment: { status: "succeeded", amount: "2500", currency: "usd" },
    q_cta: "clicked",
    hf_source: "google",
    hf_campaign: "summer2024",
  },
  variables: {
    var_score: 42,
    var_note: "test note",
  },
  meta: { source: "web", url: "https://example.com/survey" },
  tags: [],
  ttc: {},
  singleUseId: null,
  contact: null,
  contactAttributes: {},
  language: null,
} as unknown as TResponse;

// Resolved response data mirrors response.data (storage URLs already resolved)
const mockResolvedResponseData: Record<string, unknown> = { ...mockResponse.data };

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("transformToTypeformPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-set mock implementations after vitestSetup's vi.resetAllMocks()
    vi.mocked(uuidv7).mockReturnValue("mock-uuid-v7-event-id");
    vi.mocked(getElementsFromBlocks).mockImplementation((blocks: any[]) =>
      blocks.flatMap((b: any) => b.elements)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Top-Level Payload Structure Tests
  // =========================================================================

  describe("top-level payload structure", () => {
    test("should return a valid ZTypeformCompatiblePayload structure", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      expect(() => ZTypeformCompatiblePayload.parse(result)).not.toThrow();
    });

    test("should set event_type to 'form_response'", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      expect(result.event_type).toBe("form_response");
    });

    test("should set form_id to survey ID", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      expect(result.form_id).toBe("survey123");
    });

    test("should set event_id from uuid v7", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      expect(result.event_id).toBe("mock-uuid-v7-event-id");
    });

    test("should set landed_at from response.createdAt ISO string", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      expect(result.landed_at).toBe("2024-06-15T10:30:00.000Z");
    });

    test("should set submitted_at from response.updatedAt ISO string when available", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      expect(result.submitted_at).toBe("2024-06-15T10:35:00.000Z");
    });

    test("should fall back to createdAt for submitted_at when updatedAt is absent", () => {
      const responseNoUpdate = {
        ...mockResponse,
        updatedAt: undefined,
      } as unknown as TResponse;
      const result = transformToTypeformPayload(responseNoUpdate, mockSurvey, mockResolvedResponseData);
      expect(result.submitted_at).toBe("2024-06-15T10:30:00.000Z");
    });
  });

  // =========================================================================
  // 2. Element Type Transformation Tests — the 17 types in this fixture
  // =========================================================================

  describe("element type transformations", () => {
    // Helper to find an answer by field ID
    const findAnswer = (answers: any[], fieldId: string) => answers.find((a: any) => a.field.id === fieldId);

    test("should transform openText to text type answer", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_opentext");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("text");
      expect(answer.text).toBe("This is my open text answer");
      expect(answer.field.type).toBe("short_text");
      expect(answer.field.ref).toBe("q_opentext");
    });

    test("should transform multipleChoiceSingle to choice type answer", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_mcsingle");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("choice");
      expect(answer.choice).toEqual({ label: "choice_a" });
      expect(answer.field.type).toBe("multiple_choice");
    });

    test("should transform multipleChoiceMulti to choices type answer", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_mcmulti");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("choices");
      expect(answer.choices).toEqual({ labels: ["choice_x", "choice_y"] });
      expect(answer.field.type).toBe("multiple_choice");
    });

    test("should transform rating to number type answer", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_rating");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("number");
      expect(answer.number).toBe(4);
      expect(answer.field.type).toBe("rating");
    });

    test("should transform opinionScale to number type answer", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_opinionscale");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("number");
      expect(answer.number).toBe(8);
      expect(answer.field.type).toBe("opinion_scale");
    });

    test("should transform nps to number type answer", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_nps");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("number");
      expect(answer.number).toBe(9);
      expect(answer.field.type).toBe("nps");
    });

    test("should transform consent to boolean type answer with 'accepted' mapping to true", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_consent");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("boolean");
      expect(answer.boolean).toBe(true);
      expect(answer.field.type).toBe("yes_no");
    });

    test("should transform date to date type answer", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_date");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("date");
      expect(answer.date).toBe("2024-06-15");
      expect(answer.field.type).toBe("date");
    });

    test("should transform fileUpload to file_url type answer using first URL", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_fileupload");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("file_url");
      expect(answer.file_url).toBe("https://storage.example.com/file1.pdf");
      expect(answer.field.type).toBe("file_upload");
    });

    test("should transform cal to text type answer", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_cal");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("text");
      expect(answer.text).toBe("2024-06-20T14:00:00Z");
      expect(answer.field.type).toBe("cal");
    });

    test("should transform matrix to text type answer with JSON stringified value", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_matrix");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("text");
      // Matrix responses (Record<string, string>) are JSON.stringify'd
      expect(answer.text).toBe(JSON.stringify({ row1: "col1", row2: "col2" }));
      expect(answer.field.type).toBe("matrix");
    });

    test("should transform address to text type answer", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_address");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("text");
      expect(answer.text).toBe("123 Main St, Springfield, IL 62704");
      expect(answer.field.type).toBe("address");
    });

    test("should transform contactInfo to text type answer", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_contactinfo");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("text");
      expect(answer.text).toBe("john@example.com");
      expect(answer.field.type).toBe("contact_info");
    });

    test("should transform ranking to choices type answer", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_ranking");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("choices");
      expect(answer.choices).toEqual({ labels: ["option_1", "option_2", "option_3"] });
      expect(answer.field.type).toBe("ranking");
    });

    test("should transform pictureSelection (single, allowMulti=false) to choice type answer", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_pictureselection");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("choice");
      // PictureSelection single returns array with one element — transformer uses first item
      expect(answer.choice).toEqual({ label: "pic_choice_1" });
      expect(answer.field.type).toBe("picture_choice");
    });

    test("should transform pictureSelection (multiple, allowMulti=true) to choices type answer", () => {
      // Create a modified survey with allowMulti: true for picture selection
      const multiPicElement = {
        ...(mockSurvey as any).blocks[0].elements[14],
        allowMulti: true,
      };
      const modifiedSurvey = {
        ...mockSurvey,
        blocks: [
          {
            ...(mockSurvey as any).blocks[0],
            elements: [
              ...(mockSurvey as any).blocks[0].elements.slice(0, 14),
              multiPicElement,
              ...(mockSurvey as any).blocks[0].elements.slice(15),
            ],
          },
        ],
      } as unknown as TSurvey;

      const multiPicResponse = {
        ...mockResponse,
        data: {
          ...mockResponse.data,
          q_pictureselection: ["pic_choice_1", "pic_choice_2"],
        },
      } as unknown as TResponse;

      const multiPicResolvedData = { ...multiPicResponse.data };

      const result = transformToTypeformPayload(multiPicResponse, modifiedSurvey, multiPicResolvedData);
      const answer = findAnswer(result.answers, "q_pictureselection");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("choices");
      expect(answer.choices).toEqual({ labels: ["pic_choice_1", "pic_choice_2"] });
    });

    test("should transform payment to payment type answer", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_payment");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("payment");
      expect(answer.payment).toEqual({
        amount: "2500",
        currency: "usd",
        status: "succeeded",
      });
      expect(answer.field.type).toBe("payment");
    });

    test("should transform cta to boolean type answer with 'clicked' mapping to true", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const answer = findAnswer(result.answers, "q_cta");
      expect(answer).toBeDefined();
      expect(answer.type).toBe("boolean");
      expect(answer.boolean).toBe(true);
      expect(answer.field.type).toBe("yes_no");
    });

    test("should include this fixture's 17 answered elements (excluding hidden fields)", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      // This fixture answers 17 of the element types and 0 hidden field IDs overlap with element IDs. The
      // count is the fixture's own, not the enum's: the slider is covered by its own suites below.
      expect(result.answers).toHaveLength(17);
    });
  });

  // =========================================================================
  // 3. Definition.fields Generation Tests
  // =========================================================================

  describe("definition.fields generation", () => {
    test("should include all survey elements in definition.fields", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      expect(result.definition.fields).toHaveLength(17);
    });

    test("should map each field with id, title, type, and ref", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      result.definition.fields.forEach((field) => {
        expect(field).toHaveProperty("id");
        expect(field).toHaveProperty("title");
        expect(field).toHaveProperty("type");
        expect(field).toHaveProperty("ref");
        expect(typeof field.id).toBe("string");
        expect(typeof field.title).toBe("string");
        expect(typeof field.type).toBe("string");
        expect(typeof field.ref).toBe("string");
      });
    });

    test("should set definition.id to survey ID", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      expect(result.definition.id).toBe("survey123");
    });

    test("should set definition.title to survey name", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      expect(result.definition.title).toBe("Test Comprehensive Survey");
    });

    test("should use element headline.default as field title", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const openTextField = result.definition.fields.find((f) => f.id === "q_opentext");
      expect(openTextField?.title).toBe("What is your feedback?");
    });

    test("should map element type to corresponding Typeform field type", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const typeMap: Record<string, string> = {
        q_opentext: "short_text",
        q_mcsingle: "multiple_choice",
        q_mcmulti: "multiple_choice",
        q_rating: "rating",
        q_opinionscale: "opinion_scale",
        q_nps: "nps",
        q_consent: "yes_no",
        q_date: "date",
        q_fileupload: "file_upload",
        q_cal: "cal",
        q_matrix: "matrix",
        q_address: "address",
        q_contactinfo: "contact_info",
        q_ranking: "ranking",
        q_pictureselection: "picture_choice",
        q_payment: "payment",
        q_cta: "yes_no",
      };

      for (const [elementId, expectedType] of Object.entries(typeMap)) {
        const field = result.definition.fields.find((f) => f.id === elementId);
        expect(field?.type).toBe(expectedType);
      }
    });

    test("should set field ref to match field id", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      result.definition.fields.forEach((field) => {
        expect(field.ref).toBe(field.id);
      });
    });
  });

  // =========================================================================
  // 4. Hidden Fields Separation Tests
  // =========================================================================

  describe("hidden fields separation", () => {
    test("should separate hidden fields into dedicated hidden object", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      expect(result.hidden).toEqual({
        hf_source: "google",
        hf_campaign: "summer2024",
      });
    });

    test("should NOT include hidden fields in answers array", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const hiddenFieldIds = ["hf_source", "hf_campaign"];
      result.answers.forEach((answer) => {
        expect(hiddenFieldIds).not.toContain(answer.field.id);
      });
    });

    test("should handle survey with no hidden fields enabled", () => {
      const surveyNoHidden = {
        ...mockSurvey,
        hiddenFields: { enabled: false, fieldIds: [] },
      } as unknown as TSurvey;
      const responseNoHidden = {
        ...mockResponse,
        data: { q_opentext: "test" },
      } as unknown as TResponse;
      const result = transformToTypeformPayload(responseNoHidden, surveyNoHidden, { q_opentext: "test" });
      expect(result.hidden).toEqual({});
    });

    test("should handle hidden fields that have no response value", () => {
      const responsePartialHidden = {
        ...mockResponse,
        data: {
          ...mockResponse.data,
          hf_campaign: undefined, // hidden field with no value
        },
      } as unknown as TResponse;
      const resolvedPartial = { ...responsePartialHidden.data };
      const result = transformToTypeformPayload(responsePartialHidden, mockSurvey, resolvedPartial);
      // hf_campaign should be absent from hidden since value is undefined
      expect(result.hidden).toHaveProperty("hf_source", "google");
      expect(result.hidden).not.toHaveProperty("hf_campaign");
    });
  });

  // =========================================================================
  // 5. Variables Restructuring Tests
  // =========================================================================

  describe("variables restructuring", () => {
    test("should restructure variables into typed array with key/type/value", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      expect(result.variables).toHaveLength(2);
    });

    test("should correctly type number variables", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const numVar = result.variables.find((v) => v.key === "Total Score");
      expect(numVar).toBeDefined();
      expect(numVar?.type).toBe("number");
      expect(numVar?.number).toBe(42);
    });

    test("should correctly type text variables", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const textVar = result.variables.find((v) => v.key === "Note");
      expect(textVar).toBeDefined();
      expect(textVar?.type).toBe("text");
      expect(textVar?.text).toBe("test note");
    });

    test("should handle survey with no variables defined", () => {
      const surveyNoVars = {
        ...mockSurvey,
        variables: [],
      } as unknown as TSurvey;
      const result = transformToTypeformPayload(mockResponse, surveyNoVars, mockResolvedResponseData);
      expect(result.variables).toEqual([]);
    });

    test("should handle survey with undefined variables", () => {
      const surveyNullVars = {
        ...mockSurvey,
        variables: undefined,
      } as unknown as TSurvey;
      const result = transformToTypeformPayload(mockResponse, surveyNullVars, mockResolvedResponseData);
      expect(result.variables).toEqual([]);
    });

    test("should skip variables that have no matching response value", () => {
      const responseNoVars = {
        ...mockResponse,
        variables: {},
      } as unknown as TResponse;
      const result = transformToTypeformPayload(responseNoVars, mockSurvey, mockResolvedResponseData);
      // Both var_score and var_note have undefined values → both should be filtered out
      expect(result.variables).toEqual([]);
    });
  });

  // =========================================================================
  // 6. Calculated Score Tests
  // =========================================================================

  describe("calculated score", () => {
    test("should include calculated.score field as a number", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      expect(result.calculated).toHaveProperty("score");
      expect(typeof result.calculated.score).toBe("number");
    });

    test("should compute score by summing rating, nps, and opinionScale values", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      // Rating: 4, OpinionScale: 8, NPS: 9 → total = 21
      expect(result.calculated.score).toBe(21);
    });

    test("should return 0 score when no numeric responses exist", () => {
      const emptyDataResponse = {
        ...mockResponse,
        data: {},
      } as unknown as TResponse;
      const result = transformToTypeformPayload(emptyDataResponse, mockSurvey, {});
      expect(result.calculated.score).toBe(0);
    });

    test("should handle string-typed numeric values in score computation", () => {
      const stringNumResponse = {
        ...mockResponse,
        data: {
          ...mockResponse.data,
          q_rating: "5", // string instead of number
          q_nps: "10",
          q_opinionscale: "7",
        },
      } as unknown as TResponse;
      const resolvedStringNum = { ...stringNumResponse.data };
      const result = transformToTypeformPayload(stringNumResponse, mockSurvey, resolvedStringNum);
      // 5 + 10 + 7 = 22
      expect(result.calculated.score).toBe(22);
    });
  });

  // =========================================================================
  // 7. Edge Cases Tests
  // =========================================================================

  describe("edge cases", () => {
    test("should handle empty response data", () => {
      const emptyResponse = {
        ...mockResponse,
        data: {},
        variables: {},
      } as unknown as TResponse;
      const result = transformToTypeformPayload(emptyResponse, mockSurvey, {});
      expect(result.answers).toHaveLength(0);
      expect(result.hidden).toEqual({});
    });

    test("should handle missing fields in response data (questions with no answers)", () => {
      const partialResponse = {
        ...mockResponse,
        data: { q_opentext: "only this" },
      } as unknown as TResponse;
      const result = transformToTypeformPayload(partialResponse, mockSurvey, { q_opentext: "only this" });
      // Should only include answers for questions that have response data
      expect(result.answers.length).toBeGreaterThanOrEqual(1);
      expect(result.answers.length).toBeLessThan(17);
    });

    test("should handle null values in response data by skipping those answers", () => {
      const nullResponse = {
        ...mockResponse,
        data: { q_opentext: null, q_rating: 5 },
      } as unknown as TResponse;
      const resolvedNull: Record<string, unknown> = { q_opentext: null, q_rating: 5 };
      const result = transformToTypeformPayload(nullResponse, mockSurvey, resolvedNull);
      // q_opentext should be skipped (null), q_rating should be present
      const openTextAnswer = result.answers.find((a) => a.field.id === "q_opentext");
      const ratingAnswer = result.answers.find((a) => a.field.id === "q_rating");
      expect(openTextAnswer).toBeUndefined();
      expect(ratingAnswer).toBeDefined();
    });

    test("should handle undefined values in response data by skipping those answers", () => {
      const undefinedResponse = {
        ...mockResponse,
        data: { q_opentext: undefined },
      } as unknown as TResponse;
      const resolvedUndefined: Record<string, unknown> = { q_opentext: undefined };
      const result = transformToTypeformPayload(undefinedResponse, mockSurvey, resolvedUndefined);
      const openTextAnswer = result.answers.find((a) => a.field.id === "q_opentext");
      expect(openTextAnswer).toBeUndefined();
    });

    test("should handle survey with no variables", () => {
      const surveyNoVars = {
        ...mockSurvey,
        variables: [],
      } as unknown as TSurvey;
      const result = transformToTypeformPayload(mockResponse, surveyNoVars, mockResolvedResponseData);
      expect(result.variables).toEqual([]);
    });

    test("should validate full output against ZTypeformCompatiblePayload schema via safeParse", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      const parseResult = ZTypeformCompatiblePayload.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    test("should handle consent with non-accepted value mapping to false", () => {
      const declinedResponse = {
        ...mockResponse,
        data: { ...mockResponse.data, q_consent: "declined" },
      } as unknown as TResponse;
      const resolvedDeclined = { ...declinedResponse.data };
      const result = transformToTypeformPayload(declinedResponse, mockSurvey, resolvedDeclined);
      const consentAnswer = result.answers.find((a) => a.field.id === "q_consent");
      expect(consentAnswer).toBeDefined();
      expect(consentAnswer?.boolean).toBe(false);
    });

    test("should handle CTA with non-clicked value mapping to false", () => {
      const notClickedResponse = {
        ...mockResponse,
        data: { ...mockResponse.data, q_cta: "dismissed" },
      } as unknown as TResponse;
      const resolvedNotClicked = { ...notClickedResponse.data };
      const result = transformToTypeformPayload(notClickedResponse, mockSurvey, resolvedNotClicked);
      const ctaAnswer = result.answers.find((a) => a.field.id === "q_cta");
      expect(ctaAnswer).toBeDefined();
      expect(ctaAnswer?.boolean).toBe(false);
    });

    test("should handle payment with missing fields by using defaults", () => {
      const incompletePaymentResponse = {
        ...mockResponse,
        data: { ...mockResponse.data, q_payment: { status: "pending" } },
      } as unknown as TResponse;
      const resolvedIncomplete = { ...incompletePaymentResponse.data };
      const result = transformToTypeformPayload(incompletePaymentResponse, mockSurvey, resolvedIncomplete);
      const paymentAnswer = result.answers.find((a) => a.field.id === "q_payment");
      expect(paymentAnswer).toBeDefined();
      expect(paymentAnswer?.payment?.status).toBe("pending");
      expect(paymentAnswer?.payment?.amount).toBe("0");
      // currency falls back to element.currency ("usd") when missing from response
      expect(paymentAnswer?.payment?.currency).toBe("usd");
    });

    test("should handle fileUpload with empty array by using empty string", () => {
      const emptyFileResponse = {
        ...mockResponse,
        data: { ...mockResponse.data, q_fileupload: [] },
      } as unknown as TResponse;
      const resolvedEmptyFile = { ...emptyFileResponse.data };
      const result = transformToTypeformPayload(emptyFileResponse, mockSurvey, resolvedEmptyFile);
      const fileAnswer = result.answers.find((a) => a.field.id === "q_fileupload");
      expect(fileAnswer).toBeDefined();
      expect(fileAnswer?.file_url).toBe("");
    });

    test("should call getElementsFromBlocks with survey blocks", () => {
      transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      // getElementsFromBlocks is called internally — once for buildDefinitionFields,
      // once for the answers loop, once for computeScore
      expect(getElementsFromBlocks).toHaveBeenCalled();
    });

    test("should generate unique event_id from uuid v7 on each call", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      expect(uuidv7).toHaveBeenCalled();
      expect(result.event_id).toBe("mock-uuid-v7-event-id");
    });

    test("should produce a payload that passes strict Zod schema validation", () => {
      const result = transformToTypeformPayload(mockResponse, mockSurvey, mockResolvedResponseData);
      // Verify every top-level key exists
      expect(result).toHaveProperty("event_id");
      expect(result).toHaveProperty("event_type");
      expect(result).toHaveProperty("form_id");
      expect(result).toHaveProperty("landed_at");
      expect(result).toHaveProperty("submitted_at");
      expect(result).toHaveProperty("definition");
      expect(result).toHaveProperty("answers");
      expect(result).toHaveProperty("hidden");
      expect(result).toHaveProperty("variables");
      expect(result).toHaveProperty("calculated");
      // Full schema validation
      expect(() => ZTypeformCompatiblePayload.parse(result)).not.toThrow();
    });
  });

  // =========================================================================
  // 8. Slider Element Transformation Tests
  // =========================================================================

  describe("slider element transformation", () => {
    // The slider is exercised through a dedicated single-element fixture rather than by extending the
    // comprehensive mockSurvey above, so every count already asserted against that fixture stays exact.
    const sliderSurvey = {
      id: "survey_slider",
      name: "Test Slider Survey",
      blocks: [
        {
          id: "block_slider",
          name: "Slider Block",
          elements: [
            {
              id: "q_slider",
              type: TSurveyElementTypeEnum.Slider,
              headline: { default: "How satisfied are you?" },
              required: true,
              range: { min: 0, max: 100 },
              step: 5,
              subheader: { default: "" },
            },
          ],
        },
      ],
      hiddenFields: {
        enabled: false,
        fieldIds: [],
      },
      variables: [],
    } as unknown as TSurvey;

    const sliderResponse = {
      id: "response_slider",
      createdAt: new Date("2024-06-15T10:30:00Z"),
      updatedAt: new Date("2024-06-15T10:35:00Z"),
      surveyId: "survey_slider",
      finished: true,
      data: {
        q_slider: 50,
      },
      variables: {},
    } as unknown as TResponse;

    const resolvedSliderData: Record<string, unknown> = { ...sliderResponse.data };

    test("should transform slider to number type answer", () => {
      const result = transformToTypeformPayload(sliderResponse, sliderSurvey, resolvedSliderData);
      const answer = result.answers.find((a) => a.field.id === "q_slider");
      expect(answer).toBeDefined();
      expect(answer?.type).toBe("number");
      expect(answer?.number).toBe(50);
      expect(typeof answer?.number).toBe("number");
      expect(answer?.field.type).toBe("number");
      expect(answer?.field.ref).toBe("q_slider");
    });

    test("should include the slider answer in the answers array rather than dropping it", () => {
      const result = transformToTypeformPayload(sliderResponse, sliderSurvey, resolvedSliderData);
      expect(result.answers).toHaveLength(1);
      expect(result.answers[0].field.id).toBe("q_slider");
    });

    test("should map slider to a number field in definition.fields, not the raw element type", () => {
      const result = transformToTypeformPayload(sliderResponse, sliderSurvey, resolvedSliderData);
      const field = result.definition.fields.find((f) => f.id === "q_slider");
      expect(field).toBeDefined();
      expect(field?.type).toBe("number");
      expect(field?.type).not.toBe("slider");
      expect(field?.title).toBe("How satisfied are you?");
      expect(field?.ref).toBe("q_slider");
    });

    test("should transform a slider answered with its minimum of 0 instead of skipping it", () => {
      const zeroResponse = {
        ...sliderResponse,
        data: { q_slider: 0 },
      } as unknown as TResponse;
      const result = transformToTypeformPayload(zeroResponse, sliderSurvey, { q_slider: 0 });
      const answer = result.answers.find((a) => a.field.id === "q_slider");
      // 0 is a legitimate selection for a range that starts at 0 — only null/undefined mean unanswered
      expect(answer).toBeDefined();
      expect(answer?.number).toBe(0);
    });

    test("should skip an unanswered slider while still publishing its field definition", () => {
      const emptyResponse = {
        ...sliderResponse,
        data: {},
      } as unknown as TResponse;
      const result = transformToTypeformPayload(emptyResponse, sliderSurvey, {});
      expect(result.answers).toHaveLength(0);
      expect(result.definition.fields).toHaveLength(1);
    });

    test("should leave calculated.score at 0 for a slider-only survey", () => {
      const result = transformToTypeformPayload(sliderResponse, sliderSurvey, resolvedSliderData);
      // computeScore sums rating, nps and opinionScale only — the slider is deliberately excluded
      expect(result.calculated.score).toBe(0);
    });

    test("should produce a payload that passes ZTypeformCompatiblePayload validation", () => {
      const result = transformToTypeformPayload(sliderResponse, sliderSurvey, resolvedSliderData);
      expect(() => ZTypeformCompatiblePayload.parse(result)).not.toThrow();
    });

    // Builds the payload for a single raw slider value so each unanswered or malformed representation
    // can be asserted without repeating the fixture spread in every test below.
    const transformSliderValue = (value: unknown) => {
      const response = {
        ...sliderResponse,
        data: { q_slider: value },
      } as unknown as TResponse;
      return transformToTypeformPayload(response, sliderSurvey, { q_slider: value });
    };

    test("should omit an empty string instead of publishing a false 0 answer", () => {
      const result = transformSliderValue("");
      // Shared response validation treats "" as unanswered, while Number("") coerces it to 0 — which
      // would publish the range minimum as though the respondent had selected it.
      expect(result.answers).toHaveLength(0);
      // The field definition is still published, exactly as it is for an omitted key
      expect(result.definition.fields).toHaveLength(1);
      expect(result.definition.fields[0].type).toBe("number");
    });

    test("should omit a whitespace-only string instead of publishing a false 0 answer", () => {
      const result = transformSliderValue("   ");
      expect(result.answers).toHaveLength(0);
    });

    test("should omit an empty array instead of publishing a false 0 answer", () => {
      // Number([]) is also 0, so an empty collection must never reach the coercion either
      const result = transformSliderValue([]);
      expect(result.answers).toHaveLength(0);
    });

    test("should omit an empty object instead of publishing NaN", () => {
      // Number({}) is NaN, which JSON serialises to null and which the answer schema rejects
      const result = transformSliderValue({});
      expect(result.answers).toHaveLength(0);
      expect(() => ZTypeformCompatiblePayload.parse(result)).not.toThrow();
    });

    test("should omit populated objects and arrays rather than publishing a coerced value", () => {
      expect(transformSliderValue({ min: 0, max: 100 }).answers).toHaveLength(0);
      expect(transformSliderValue([50]).answers).toHaveLength(0);
    });

    test("should omit an unparseable string rather than publishing NaN", () => {
      const result = transformSliderValue("not-a-number");
      expect(result.answers).toHaveLength(0);
      expect(() => ZTypeformCompatiblePayload.parse(result)).not.toThrow();
    });

    test("should omit NaN and both infinities rather than publishing a non-finite number", () => {
      // A non-finite number cannot be represented in JSON: it serialises to null, so it is withheld
      expect(transformSliderValue(Number.NaN).answers).toHaveLength(0);
      expect(transformSliderValue(Number.POSITIVE_INFINITY).answers).toHaveLength(0);
      expect(transformSliderValue(Number.NEGATIVE_INFINITY).answers).toHaveLength(0);
    });

    test("should omit a numeric string rather than coercing it for a slider", () => {
      // Numeric-string tolerance belongs to rating, nps and opinionScale alone, whose stored answers may
      // legitimately be strings; the sibling suite below guards that. A slider's answer contract is exactly
      // one number and the shared evaluator rejects every other shape at ingress, so a string here can only
      // be corruption and is withheld.
      expect(transformSliderValue("50").answers).toHaveLength(0);
      expect(transformSliderValue("  50  ").answers).toHaveLength(0);
    });

    test("should keep publishing every finite selection untouched", () => {
      // The other side of the omissions above: a real selection is never dropped. Whether a value is inside
      // the configured range is decided by response validation at ingress, not here.
      expect(transformSliderValue(50).answers[0].number).toBe(50);
      expect(transformSliderValue(0).answers[0].number).toBe(0);
      expect(transformSliderValue(2.5).answers[0].number).toBe(2.5);
      expect(transformSliderValue(-5).answers[0].number).toBe(-5);
    });
  });

  // =========================================================================
  // 9. Numeric Answer Integrity Tests
  // =========================================================================

  /**
   * The slider's side of the shared `number` branch.
   *
   * Its answer contract is exactly one number and the shared evaluator rejects every other shape at ingress,
   * so anything else in its slot is corruption rather than an answer. Coercing it would be wrong in both
   * directions: `Number("")` and `Number([])` are `0`, which for a slider whose range starts at 0 is
   * indistinguishable from a real selection, while `Number({})` is `NaN`, which has no JSON representation and
   * is rejected outright by ZTypeformCompatiblePayload. The slider therefore omits the answer, which is
   * already how an unanswered question is reported.
   *
   * What rating, nps and opinionScale publish is their own contract, asserted by the sibling suite rather
   * than restated here.
   *
   * These suites use dedicated single-element fixtures, so every count asserted against the comprehensive
   * mockSurvey above stays exact.
   */
  describe("numeric answer integrity", () => {
    const buildNumericSurvey = (elementType: TSurveyElementTypeEnum): TSurvey =>
      ({
        id: "survey_numeric",
        name: "Test Numeric Survey",
        blocks: [
          {
            id: "block_numeric",
            name: "Numeric Block",
            elements: [
              {
                id: "q_numeric",
                type: elementType,
                headline: { default: "Pick a value" },
                required: false,
                range: { min: 0, max: 100 },
                step: 5,
              },
            ],
          },
        ],
        hiddenFields: { enabled: false, fieldIds: [] },
        variables: [],
      }) as unknown as TSurvey;

    const buildNumericResponse = (value: unknown): TResponse =>
      ({
        id: "response_numeric",
        createdAt: new Date("2024-06-15T10:30:00Z"),
        updatedAt: new Date("2024-06-15T10:35:00Z"),
        surveyId: "survey_numeric",
        finished: true,
        data: { q_numeric: value },
        variables: {},
      }) as unknown as TResponse;

    const transformNumeric = (elementType: TSurveyElementTypeEnum, value: unknown) =>
      transformToTypeformPayload(buildNumericResponse(value), buildNumericSurvey(elementType), {
        q_numeric: value,
      });

    // None of these is a number a respondent could have selected on a slider: "" and [] would have become a
    // fabricated 0, {} an unpublishable NaN, and Infinity a value outside any configured range. NaN itself is
    // covered separately below. This list drives the slider's omission suite and, inverted, the coercion
    // suite for the three numeric types that do tolerate a string.
    const unpublishableShapes: [string, unknown][] = [
      ["an empty string", ""],
      ["a whitespace-only string", "   "],
      ["an empty array", []],
      ["a populated array", ["50"]],
      ["an empty record", {}],
      ["a populated record", { value: 50 }],
      ["a non-numeric string", "abc"],
      ["a partially numeric string", "50junk"],
      ["positive Infinity", Number.POSITIVE_INFINITY],
      ["negative Infinity", Number.NEGATIVE_INFINITY],
      ["a boolean", true],
    ];

    // Strictness is asserted for the slider alone: rating, nps and opinionScale answer to the tolerant
    // contract their consumers already receive, which the sibling suite covers.
    describe("slider", () => {
      test.each(unpublishableShapes)("should omit the answer for %s", (_label, value) => {
        const result = transformNumeric(TSurveyElementTypeEnum.Slider, value);

        expect(result.answers).toHaveLength(0);
        expect(result.answers.find((a) => a.field.id === "q_numeric")).toBeUndefined();
        expect(result.definition.fields).toHaveLength(1);
        expect(() => ZTypeformCompatiblePayload.parse(result)).not.toThrow();
      });

      // NaN is the one shape `ZResponseDataValue` refuses outright - `z.number()` rejects it - so it cannot
      // reach the transformer from storage at all. It is asserted regardless, as defence in depth for a pure
      // function any caller can reach.
      test("should omit the answer for NaN", () => {
        const result = transformNumeric(TSurveyElementTypeEnum.Slider, Number.NaN);

        expect(result.answers).toHaveLength(0);
        expect(result.definition.fields).toHaveLength(1);
      });
    });

    describe("slider values that do publish", () => {
      const elementType = TSurveyElementTypeEnum.Slider;

      test.each([
        ["an in-range integer", 50],
        ["zero", 0],
        ["a decimal", 12.5],
        ["a negative number", -10],
      ])("should publish %s as a real number", (_label, value) => {
        const result = transformNumeric(elementType, value);
        const answer = result.answers.find((a) => a.field.id === "q_numeric");

        expect(answer).toBeDefined();
        expect(answer?.type).toBe("number");
        expect(answer?.number).toBe(value);
        expect(typeof answer?.number).toBe("number");
      });

      test("should omit the answer when the key is absent altogether", () => {
        const result = transformToTypeformPayload(
          buildNumericResponse(undefined),
          buildNumericSurvey(elementType),
          {}
        );

        expect(result.answers).toHaveLength(0);
      });

      test("should omit the answer for an explicit null", () => {
        const result = transformNumeric(elementType, null);

        expect(result.answers).toHaveLength(0);
      });
    });

    test("should keep the payload schema-valid when a slider answer is NaN", () => {
      // The slider is deliberately excluded from computeScore, so once the answer is omitted nothing else in
      // the payload carries the NaN forward - and a NaN anywhere in it would make it unpublishable.
      const result = transformNumeric(TSurveyElementTypeEnum.Slider, Number.NaN);

      expect(result.answers).toHaveLength(0);
      expect(result.calculated.score).toBe(0);
      expect(() => ZTypeformCompatiblePayload.parse(result)).not.toThrow();
    });

    // The slider's answer contract is exactly one number and the shared evaluator rejects every other shape
    // at ingress, so a string in a slider's slot can only be corruption and must not be coerced.
    test.each([
      ["a numeric string", "50"],
      ["a padded numeric string", "  50  "],
      ["a zero string", "0"],
      ["a decimal string", "12.5"],
    ])("should not coerce %s for a slider", (_label, value) => {
      const result = transformNumeric(TSurveyElementTypeEnum.Slider, value);

      expect(result.answers).toHaveLength(0);
      expect(result.definition.fields).toHaveLength(1);
    });

    test("should leave every non-numeric answer type untouched", () => {
      // The slider's strictness lives in the "number" branch alone, so a text answer stringifies whatever it
      // holds - including the empty string, which is a legitimate text value rather than an absent one.
      const textResult = transformNumeric(TSurveyElementTypeEnum.OpenText, "");
      const textAnswer = textResult.answers.find((a) => a.field.id === "q_numeric");
      expect(textAnswer).toBeDefined();
      expect(textAnswer?.type).toBe("text");
      expect(textAnswer?.text).toBe("");

      const consentResult = transformNumeric(TSurveyElementTypeEnum.Consent, "accepted");
      const consentAnswer = consentResult.answers.find((a) => a.field.id === "q_numeric");
      expect(consentAnswer).toBeDefined();
      expect(consentAnswer?.boolean).toBe(true);
    });
  });
});
