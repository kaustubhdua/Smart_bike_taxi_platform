import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Loader2, Search } from "lucide-react";
import { rememberSelectedPlace, searchPlaces, suggestionMode, type PlaceSuggestion } from "../lib/routing";

type Option = { key: string; label: string; detail: string; place?: PlaceSuggestion };

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon: ReactNode;
  placeholder: string;
  /** Well-known places shown when the field is focused and nothing has been typed. */
  popularPlaces: string[];
};

const TYPEAHEAD_DELAY_MS = 350;

/**
 * Pickup/drop-off combobox following the WAI-ARIA Authoring Practices "editable combobox
 * with list autocomplete" pattern: the input keeps focus, options are referenced through
 * aria-activedescendant, ArrowUp/ArrowDown move, Enter selects, Escape closes, and results
 * are announced through a polite live region.
 *
 * Search policy: with the public Nominatim service a search runs only when the person
 * submits (Enter or the Search button), never per keystroke. With a Photon-compatible
 * VITE_AUTOCOMPLETE_URL it also runs as they type, debounced.
 */
export default function LocationField({ label, value, onChange, icon, placeholder, popularPlaces }: Props) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorText, setErrorText] = useState("");
  const [active, setActive] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);
  const typedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const query = value.trim();
  const showPopular = query.length < 3;
  const options: Option[] = showPopular
    ? popularPlaces.map(place => ({ key: `p:${place}`, label: place, detail: "Popular nearby" }))
    : results.map((place, index) => ({ key: `r:${index}:${place.label}`, label: place.label, detail: place.detail, place }));

  function cancelSearch() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  async function runSearch() {
    if (query.length < 3) return;
    cancelSearch();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setErrorText("");
    setOpen(true);
    setActive(-1);
    try {
      const found = await searchPlaces(query, controller.signal);
      if (controller.signal.aborted) return;
      setResults(found);
      setStatus("done");
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
      setResults([]);
      setStatus("error");
      setErrorText(error instanceof Error ? error.message : "Place search failed.");
    }
  }

  // As-you-type suggestions exist only for a typeahead-capable provider.
  useEffect(() => {
    if (suggestionMode !== "typeahead" || !typedRef.current) return;
    if (query.length < 3) {
      cancelSearch();
      setResults([]);
      setStatus("idle");
      return;
    }
    const timer = setTimeout(() => { void runSearch(); }, TYPEAHEAD_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => () => cancelSearch(), []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function choose(option: Option) {
    typedRef.current = false;
    cancelSearch();
    if (option.place) rememberSelectedPlace(option.place);
    onChange(option.label);
    setOpen(false);
    setActive(-1);
    setStatus("idle");
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) { setOpen(true); setActive(options.length ? 0 : -1); break; }
        setActive(options.length ? (active + 1) % options.length : -1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) { setOpen(true); setActive(options.length ? options.length - 1 : -1); break; }
        setActive(options.length ? (active <= 0 ? options.length - 1 : active - 1) : -1);
        break;
      case "Home":
        if (open && options.length) { event.preventDefault(); setActive(0); }
        break;
      case "End":
        if (open && options.length) { event.preventDefault(); setActive(options.length - 1); }
        break;
      case "Enter":
        if (open && active >= 0 && options[active]) {
          event.preventDefault();
          choose(options[active]);
        } else if (query.length >= 3) {
          event.preventDefault();
          void runSearch();
        }
        break;
      case "Escape":
        if (open) { event.preventDefault(); setOpen(false); setActive(-1); }
        break;
      default:
    }
  }

  let message = "";
  if (open) {
    if (status === "loading") message = "Searching places…";
    else if (status === "error") message = errorText;
    else if (!showPopular && status === "done") {
      message = results.length === 0
        ? `No places found for “${query}”. Try a landmark, sector or street name.`
        : `${results.length} place${results.length === 1 ? "" : "s"} found. Use the up and down arrow keys to review.`;
    } else if (!showPopular && status === "idle" && suggestionMode === "submit") {
      message = "Press Enter or Search to look up this place.";
    }
  }

  const activeId = open && active >= 0 && options[active] ? `${listId}-${active}` : undefined;
  const canSearch = query.length >= 3 && status !== "loading";

  return (
    <div className="location-field location-combobox" ref={rootRef}>
      <label htmlFor={`${uid}-input`}><span>{label}</span></label>
      <div className="field-control">
        {icon}
        <input
          id={`${uid}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
          onChange={event => {
            typedRef.current = true;
            onChange(event.target.value);
            setStatus("idle");
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="location-search"
          aria-label="Search for this place"
          disabled={!canSearch}
          onClick={() => { void runSearch(); }}
        >
          {status === "loading" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Search size={15} aria-hidden="true" />}
        </button>
      </div>
      <ul id={listId} role="listbox" aria-label={`Suggestions for ${label.split(" ")[0].toLowerCase()}`} className="location-options" hidden={!open || options.length === 0}>
        {options.map((option, index) => (
          <li
            key={option.key}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            className={index === active ? "is-active" : undefined}
            // mousedown (not click) so the input keeps focus and the blur handler cannot close the list first.
            onMouseDown={event => { event.preventDefault(); choose(option); }}
            onMouseEnter={() => setActive(index)}
          >
            <strong>{option.label}</strong>
            {option.detail && <small>{option.detail}</small>}
          </li>
        ))}
      </ul>
      <div role="status" aria-live="polite" className="location-status">{message}</div>
    </div>
  );
}
