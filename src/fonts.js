// Fontes embutidas no app (funcionam sem internet).
// Inter: fonte da interface (parecida com a do macOS), só o alfabeto latino.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/900.css';
import '@fontsource/montserrat/400-italic.css';
import '@fontsource/montserrat/700-italic.css';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/900.css';
import '@fontsource/poppins/400-italic.css';
import '@fontsource/poppins/700-italic.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/anton/400.css';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/700.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/playfair-display/400-italic.css';
import '@fontsource/playfair-display/700-italic.css';
import '@fontsource/lobster/400.css';
import '@fontsource/pacifico/400.css';
import '@fontsource/dancing-script/400.css';
import '@fontsource/dancing-script/700.css';
import '@fontsource/permanent-marker/400.css';
import '@fontsource/bangers/400.css';
import '@fontsource/roboto-slab/400.css';
import '@fontsource/roboto-slab/700.css';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';

// family = nome usado no CSS/canvas; bold = peso usado quando "negrito" está ligado.
export const FONTS = [
  { family: 'Montserrat', label: 'Montserrat', bold: 900, italic: true },
  { family: 'Poppins', label: 'Poppins', bold: 700, italic: true },
  { family: 'Bebas Neue', label: 'Bebas Neue', bold: null },
  { family: 'Anton', label: 'Anton', bold: null },
  { family: 'Oswald', label: 'Oswald', bold: 700 },
  { family: 'Playfair Display', label: 'Playfair Display', bold: 700, italic: true },
  { family: 'Roboto Slab', label: 'Roboto Slab', bold: 700 },
  { family: 'Bangers', label: 'Bangers', bold: null },
  { family: 'Permanent Marker', label: 'Permanent Marker', bold: null },
  { family: 'Lobster', label: 'Lobster', bold: null },
  { family: 'Pacifico', label: 'Pacifico', bold: null },
  { family: 'Dancing Script', label: 'Dancing Script', bold: 700 },
  { family: 'Caveat', label: 'Caveat', bold: 700 },
  { family: 'Segoe UI', label: 'Segoe UI (sistema)', bold: 700, italic: true, system: true },
  { family: 'Arial', label: 'Arial (sistema)', bold: 700, italic: true, system: true },
  { family: 'Impact', label: 'Impact (sistema)', bold: null, system: true },
  { family: 'Georgia', label: 'Georgia (sistema)', bold: 700, italic: true, system: true },
  { family: 'Courier New', label: 'Courier New (sistema)', bold: 700, italic: true, system: true },
];

export const fontInfo = (family) => FONTS.find((f) => f.family === family) || FONTS[0];
