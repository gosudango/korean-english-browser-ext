let dictionary = {};

/*
 * Structure:
 *
 * hanjaIndex = Map {
 *     "生" => Map {
 *         "생" => [
 *             {
 *                 word: "학생",
 *                 hanja: "學生",
 *                 english: "student"
 *             }
 *         ]
 *     }
 * }
 */
const hanjaIndex = new Map();

let hoverTimer = null;
let closeTimer = null;

let currentHoveredWord = "";
let currentTextNode = null;
let currentWordStart = -1;
let popupHovered = false;

const HOVER_DELAY = 350;
const CLOSE_DELAY = 250;
const MAX_HANJA_EXAMPLES = 10;
const POPUP_ID = "korean-helper-popup";

fetch(chrome.runtime.getURL("dictionary.json"))
    .then(response => {
        if (!response.ok) {
            throw new Error(
                `Dictionary could not be loaded: ${response.status}`
            );
        }

        return response.json();
    })
    .then(data => {
        dictionary = data;
        buildHanjaIndex();

        console.log("Dictionary loaded");
        console.log(
            "Dictionary entries:",
            Object.keys(dictionary).length
        );
        console.log(
            "Indexed Hanja characters:",
            hanjaIndex.size
        );
    })
    .catch(error => {
        console.error(
            "Failed to load dictionary.json:",
            error
        );
    });

/**
 * Build an index containing every compound word in which
 * each Hanja character occurs.
 *
 * Example:
 *
 * 학생 -> 學生 -> 學/학 and 生/생
 * 생명 -> 生命 -> 生/생 and 命/명
 */
function buildHanjaIndex() {
    hanjaIndex.clear();

    for (const [koreanWord, entry] of Object.entries(dictionary)) {
        if (!entry?.hanja) {
            continue;
        }

        const hanjaValues = normalizeHanjaValues(entry.hanja);
        const english = getEnglishText(entry.english);

        for (const hanjaWord of hanjaValues) {
            const koreanSyllables = Array.from(koreanWord);
            const hanjaCharacters = Array.from(hanjaWord);

            /*
             * Positional pairing only works when both versions
             * contain the same number of characters.
             */
            if (koreanSyllables.length !== hanjaCharacters.length) {
                continue;
            }

            hanjaCharacters.forEach((hanjaCharacter, index) => {
                if (!isHanja(hanjaCharacter)) {
                    return;
                }

                const koreanReading = koreanSyllables[index];

                if (!hanjaIndex.has(hanjaCharacter)) {
                    hanjaIndex.set(
                        hanjaCharacter,
                        new Map()
                    );
                }

                const readings =
                    hanjaIndex.get(hanjaCharacter);

                if (!readings.has(koreanReading)) {
                    readings.set(koreanReading, []);
                }

                const examples =
                    readings.get(koreanReading);

                const example = {
                    word: koreanWord,
                    hanja: hanjaWord,
                    english
                };

                const isDuplicate = examples.some(existing =>
                    existing.word === example.word &&
                    existing.hanja === example.hanja
                );

                if (!isDuplicate) {
                    examples.push(example);
                }
            });
        }
    }

    /*
     * Sort shorter words first. These are generally more useful
     * than long compound expressions when no frequency data exists.
     */
    for (const readings of hanjaIndex.values()) {
        for (const examples of readings.values()) {
            examples.sort(compareExamples);
        }
    }
}

function compareExamples(a, b) {
    const lengthDifference =
        Array.from(a.word).length -
        Array.from(b.word).length;

    if (lengthDifference !== 0) {
        return lengthDifference;
    }

    return a.word.localeCompare(b.word, "ko");
}

/**
 * Convert the Hanja value into an array.
 *
 * Supported:
 *
 * "學生"
 * "學生; 學生"
 * ["學生", "學生"]
 */
function normalizeHanjaValues(hanja) {
    if (Array.isArray(hanja)) {
        return hanja
            .map(value => String(value).trim())
            .filter(Boolean);
    }

    return String(hanja)
        .split(/[,;/]/)
        .map(value => value.trim())
        .filter(Boolean);
}

function isHanja(character) {
    return /\p{Script=Han}/u.test(character);
}

/**
 * Normalize English translations.
 *
 * Supported:
 *
 * "student"
 * ["student", "pupil"]
 */
function getEnglishText(english) {
    if (Array.isArray(english)) {
        return english
            .map(value => String(value).trim())
            .filter(Boolean)
            .join("; ");
    }

    if (english === null || english === undefined) {
        return "";
    }

    return String(english).trim();
}

function getPrimaryHanja(hanja) {
    const values = normalizeHanjaValues(hanja);
    return values[0] || "";
}

/**
 * Return examples for a specific Hanja and Korean reading.
 *
 * The currently hovered word is placed first.
 */
function getHanjaExamples(
    hanjaCharacter,
    koreanReading,
    currentWord
) {
    const readings = hanjaIndex.get(hanjaCharacter);

    if (!readings) {
        return {
            examples: [],
            total: 0
        };
    }

    let examples = readings.get(koreanReading) || [];

    /*
     * If no exact Korean reading is found, collect examples
     * from every available reading.
     */
    if (examples.length === 0) {
        examples = Array.from(
            readings.values()
        ).flat();
    }

    const uniqueExamples = [];
    const seenExamples = new Set();

    for (const example of examples) {
        const key = `${example.word}|${example.hanja}`;

        if (seenExamples.has(key)) {
            continue;
        }

        seenExamples.add(key);
        uniqueExamples.push(example);
    }

    uniqueExamples.sort((a, b) => {
        const aIsCurrent =
            a.word === currentWord ? 1 : 0;

        const bIsCurrent =
            b.word === currentWord ? 1 : 0;

        if (aIsCurrent !== bIsCurrent) {
            return bIsCurrent - aIsCurrent;
        }

        return compareExamples(a, b);
    });

    return {
        examples: uniqueExamples.slice(
            0,
            MAX_HANJA_EXAMPLES
        ),
        total: uniqueExamples.length
    };
}

/**
 * Render up to ten compound-word examples for one Hanja.
 */
function renderHanjaExamples(
    hanjaCharacter,
    koreanReading,
    currentWord
) {
    const result = getHanjaExamples(
        hanjaCharacter,
        koreanReading,
        currentWord
    );

    if (result.examples.length === 0) {
        return `
            <div style="
                margin-top: 6px;
                color: #777;
                font-size: 13px;
            ">
                No example words found
            </div>
        `;
    }

    const exampleRows = result.examples
        .map(example => {
            const isCurrentWord =
                example.word === currentWord;

            return `
                <div style="
                    display: grid;
                    grid-template-columns:
                        minmax(70px, auto)
                        minmax(70px, auto)
                        1fr;
                    gap: 8px;
                    align-items: baseline;
                    margin-top: 4px;
                    padding: 3px 5px;
                    border-radius: 5px;
                    ${
                        isCurrentWord
                            ? "background-color: #eef5fb;"
                            : ""
                    }
                ">
                    <span style="
                        font-weight: 600;
                        color: #222;
                    ">
                        ${escapeHtml(example.word)}
                    </span>

                    <span style="
                        color: #1f4e79;
                        font-size: 15px;
                    ">
                        ${escapeHtml(example.hanja)}
                    </span>

                    <span style="
                        color: #555;
                        font-size: 14px;
                    ">
                        ${
                            example.english
                                ? escapeHtml(
                                    example.english
                                )
                                : "No translation"
                        }
                    </span>
                </div>
            `;
        })
        .join("");

    const resultLabel =
        result.total === 1
            ? "1 word found"
            : `${result.total} words found`;

    return `
        <div style="
            margin-top: 7px;
        ">
            <div style="
                display: flex;
                justify-content: space-between;
                gap: 12px;
                color: #777;
                font-size: 12px;
                margin-bottom: 4px;
            ">
                <span>
                    Examples
                </span>

                <span>
                    ${escapeHtml(resultLabel)}
                </span>
            </div>

            ${exampleRows}

            ${
                result.total > MAX_HANJA_EXAMPLES
                    ? `
                        <div style="
                            margin-top: 5px;
                            color: #888;
                            font-size: 12px;
                            text-align: right;
                        ">
                            Showing ${MAX_HANJA_EXAMPLES}
                            of ${result.total}
                        </div>
                    `
                    : ""
            }
        </div>
    `;
}

/**
 * Build the breakdown for every character in a Hanja word.
 */
function getHanjaBreakdown(koreanWord, hanjaWord) {
    if (!koreanWord || !hanjaWord) {
        return "";
    }

    const koreanSyllables = Array.from(koreanWord);
    const hanjaCharacters = Array.from(hanjaWord);

    if (koreanSyllables.length !== hanjaCharacters.length) {
        return `
            <div style="
                margin-top: 10px;
                padding-top: 8px;
                border-top: 1px solid #eee;
                color: #777;
                font-size: 13px;
            ">
                Individual Hanja breakdown unavailable
            </div>
        `;
    }

    return hanjaCharacters
        .map((hanjaCharacter, index) => {
            const koreanReading =
                koreanSyllables[index] || "";

            const exampleHtml =
                renderHanjaExamples(
                    hanjaCharacter,
                    koreanReading,
                    koreanWord
                );

            return `
                <div style="
                    margin-top: 12px;
                    padding-top: 10px;
                    border-top: 1px solid #ddd;
                ">
                    <div style="
                        display: flex;
                        align-items: baseline;
                        gap: 10px;
                    ">
                        <span style="
                            font-size: 28px;
                            font-weight: bold;
                            color: #1f4e79;
                        ">
                            ${escapeHtml(hanjaCharacter)}
                        </span>

                        <span style="
                            font-size: 18px;
                            font-weight: bold;
                        ">
                            ${escapeHtml(koreanReading)}
                        </span>
                    </div>

                    ${exampleHtml}
                </div>
            `;
        })
        .join("");
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/**
 * Remove one common Korean particle from the word.
 */
function removeKoreanParticle(word) {
    return word.replace(
        /(으로|에서|에게|한테|께서|까지|부터|처럼|보다|만|도|은|는|이|가|을|를|에|의|와|과|로)$/u,
        ""
    );
}

function removePopup() {
    clearTimeout(closeTimer);

    const popup = document.getElementById(POPUP_ID);

    if (popup) {
        popup.remove();
    }

    popupHovered = false;
}

function schedulePopupRemoval() {
    clearTimeout(closeTimer);

    closeTimer = setTimeout(() => {
        if (!popupHovered) {
            removePopup();
            resetCurrentWord();
        }
    }, CLOSE_DELAY);
}

function resetCurrentWord() {
    currentHoveredWord = "";
    currentTextNode = null;
    currentWordStart = -1;
}

function createPopup(rect) {
    removePopup();

    const popup = document.createElement("div");

    popup.id = POPUP_ID;

    popup.style.position = "fixed";
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom + 8}px`;
    popup.style.backgroundColor = "white";
    popup.style.color = "black";
    popup.style.border = "1px solid #ccc";
    popup.style.borderRadius = "10px";
    popup.style.padding = "12px";
    popup.style.boxShadow =
        "0 4px 12px rgba(0, 0, 0, 0.2)";
    popup.style.fontSize = "16px";
    popup.style.fontFamily =
        "Arial, sans-serif";
    popup.style.zIndex = "2147483647";
    popup.style.width = "min(520px, calc(100vw - 16px))";
    popup.style.maxWidth = "520px";
    popup.style.lineHeight = "1.5";
    popup.style.maxHeight = "70vh";
    popup.style.overflowY = "auto";
    popup.style.overflowX = "hidden";
    popup.style.overflowWrap = "break-word";
    popup.style.pointerEvents = "auto";
    popup.style.boxSizing = "border-box";

    popup.addEventListener("mouseenter", () => {
        popupHovered = true;
        clearTimeout(closeTimer);
    });

    popup.addEventListener("mouseleave", () => {
        popupHovered = false;
        schedulePopupRemoval();
    });

    return popup;
}

function positionPopupInsideViewport(popup, wordRect) {
    const popupRect = popup.getBoundingClientRect();
    const viewportPadding = 8;

    let left = wordRect.left;
    let top = wordRect.bottom + 8;

    if (
        left + popupRect.width >
        window.innerWidth - viewportPadding
    ) {
        left =
            window.innerWidth -
            popupRect.width -
            viewportPadding;
    }

    if (left < viewportPadding) {
        left = viewportPadding;
    }

    if (
        top + popupRect.height >
        window.innerHeight - viewportPadding
    ) {
        top =
            wordRect.top -
            popupRect.height -
            8;
    }

    if (top < viewportPadding) {
        top = viewportPadding;
    }

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
}

function showPopup(word, rect) {
    const wordWithoutParticle =
        removeKoreanParticle(word);

    const lookupWord =
        dictionary[wordWithoutParticle]
            ? wordWithoutParticle
            : word;

    const entry = dictionary[lookupWord];
    const popup = createPopup(rect);

    if (entry) {
        const primaryHanja = entry.hanja
            ? getPrimaryHanja(entry.hanja)
            : "";

        const english =
            getEnglishText(entry.english) ||
            "No English translation found";

        popup.innerHTML = `
            <div style="
                font-size: 20px;
                font-weight: bold;
                margin-bottom: 4px;
            ">
                ${escapeHtml(lookupWord)}
            </div>

            ${
                primaryHanja
                    ? `
                        <div style="
                            font-size: 30px;
                            color: #1f4e79;
                            margin-bottom: 5px;
                        ">
                            ${escapeHtml(primaryHanja)}
                        </div>
                    `
                    : ""
            }

            <div style="
                margin-bottom: 8px;
            ">
                ${escapeHtml(english)}
            </div>

            ${
                primaryHanja
                    ? getHanjaBreakdown(
                        lookupWord,
                        primaryHanja
                    )
                    : ""
            }
        `;
    } else {
        popup.innerHTML = `
            <div style="
                font-size: 20px;
                font-weight: bold;
            ">
                ${escapeHtml(word)}
            </div>

            <div style="
                color: #b00020;
                margin-top: 6px;
            ">
                Not found in dictionary
            </div>
        `;
    }

    document.body.appendChild(popup);
    positionPopupInsideViewport(popup, rect);
}

function getCaretFromPoint(x, y) {
    if (document.caretPositionFromPoint) {
        const position =
            document.caretPositionFromPoint(x, y);

        if (!position) {
            return null;
        }

        return {
            node: position.offsetNode,
            offset: position.offset
        };
    }

    if (document.caretRangeFromPoint) {
        const range =
            document.caretRangeFromPoint(x, y);

        if (!range) {
            return null;
        }

        return {
            node: range.startContainer,
            offset: range.startOffset
        };
    }

    return null;
}

function findKoreanWordAtPosition(text, offset) {
    if (!text) {
        return null;
    }

    let adjustedOffset = offset;

    if (
        adjustedOffset >= text.length &&
        text.length > 0
    ) {
        adjustedOffset = text.length - 1;
    }

    if (
        adjustedOffset > 0 &&
        !/[가-힣]/u.test(text[adjustedOffset]) &&
        /[가-힣]/u.test(text[adjustedOffset - 1])
    ) {
        adjustedOffset -= 1;
    }

    if (!/[가-힣]/u.test(text[adjustedOffset])) {
        return null;
    }

    let start = adjustedOffset;
    let end = adjustedOffset + 1;

    while (
        start > 0 &&
        /[가-힣]/u.test(text[start - 1])
    ) {
        start -= 1;
    }

    while (
        end < text.length &&
        /[가-힣]/u.test(text[end])
    ) {
        end += 1;
    }

    return {
        word: text.slice(start, end),
        start,
        end
    };
}

function getWordRange(textNode, start, end) {
    try {
        const range = document.createRange();

        range.setStart(textNode, start);
        range.setEnd(textNode, end);

        return range;
    } catch (error) {
        console.error(
            "Could not create word range:",
            error
        );

        return null;
    }
}

function isPointInsideRange(x, y, range) {
    const rectangles = Array.from(
        range.getClientRects()
    );

    return rectangles.some(rect =>
        x >= rect.left - 2 &&
        x <= rect.right + 2 &&
        y >= rect.top - 2 &&
        y <= rect.bottom + 2
    );
}

function getRangeBoundingRect(range) {
    const rectangles = Array.from(
        range.getClientRects()
    );

    if (rectangles.length > 0) {
        return rectangles[0];
    }

    return range.getBoundingClientRect();
}

function isIgnoredElement(element) {
    if (!element) {
        return true;
    }

    if (element.closest(`#${POPUP_ID}`)) {
        return true;
    }

    return Boolean(
        element.closest(
            [
                "input",
                "textarea",
                "select",
                "option",
                "button",
                "script",
                "style",
                "noscript",
                "[contenteditable='true']"
            ].join(",")
        )
    );
}

document.addEventListener(
    "mousemove",
    event => {
        const targetElement =
            event.target instanceof Element
                ? event.target
                : event.target?.parentElement;

        if (targetElement?.closest(`#${POPUP_ID}`)) {
            clearTimeout(closeTimer);
            return;
        }

        if (isIgnoredElement(targetElement)) {
            clearTimeout(hoverTimer);
            schedulePopupRemoval();
            return;
        }

        const caret = getCaretFromPoint(
            event.clientX,
            event.clientY
        );

        if (
            !caret ||
            caret.node?.nodeType !== Node.TEXT_NODE
        ) {
            clearTimeout(hoverTimer);
            schedulePopupRemoval();
            return;
        }

        const textNode = caret.node;
        const text = textNode.textContent || "";

        const wordInfo = findKoreanWordAtPosition(
            text,
            caret.offset
        );

        if (!wordInfo) {
            clearTimeout(hoverTimer);
            schedulePopupRemoval();
            return;
        }

        const range = getWordRange(
            textNode,
            wordInfo.start,
            wordInfo.end
        );

        if (!range) {
            return;
        }

        if (
            !isPointInsideRange(
                event.clientX,
                event.clientY,
                range
            )
        ) {
            clearTimeout(hoverTimer);
            schedulePopupRemoval();
            return;
        }

        clearTimeout(closeTimer);

        const sameWord =
            currentHoveredWord === wordInfo.word &&
            currentTextNode === textNode &&
            currentWordStart === wordInfo.start;

        if (sameWord) {
            return;
        }

        clearTimeout(hoverTimer);

        currentHoveredWord = wordInfo.word;
        currentTextNode = textNode;
        currentWordStart = wordInfo.start;

        hoverTimer = setTimeout(() => {
            const latestRange = getWordRange(
                textNode,
                wordInfo.start,
                wordInfo.end
            );

            if (!latestRange) {
                return;
            }

            const rect =
                getRangeBoundingRect(latestRange);

            if (
                rect.width === 0 ||
                rect.height === 0
            ) {
                return;
            }

            showPopup(wordInfo.word, rect);
        }, HOVER_DELAY);
    },
    { passive: true }
);

document.addEventListener(
    "mouseleave",
    () => {
        clearTimeout(hoverTimer);
        schedulePopupRemoval();
    }
);

window.addEventListener(
    "scroll",
    () => {
        clearTimeout(hoverTimer);
        removePopup();
        resetCurrentWord();
    },
    { passive: true }
);

window.addEventListener(
    "resize",
    () => {
        clearTimeout(hoverTimer);
        removePopup();
        resetCurrentWord();
    },
    { passive: true }
);