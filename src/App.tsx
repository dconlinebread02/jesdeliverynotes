/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { 
  GoogleGenAI, 
  Type, 
  GenerateContentResponse 
} from "@google/genai";
import { 
  auth, 
  db 
} from './firebase';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  getDoc, 
  getDocs,
  setDoc, 
  doc, 
  query, 
  where,
  orderBy, 
  onSnapshot, 
  serverTimestamp, 
  Timestamp,
  runTransaction,
  deleteDoc,
  updateDoc
} from 'firebase/firestore';
import { 
  FileText, 
  Upload, 
  Download, 
  Printer, 
  LogOut, 
  LogIn, 
  Plus, 
  History, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  ChevronRight,
  Trash2,
  Edit3,
  Check,
  Sliders,
  Sparkles,
  Palette,
  Eye
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import FloatingLines from './components/FloatingLines';

// --- Types ---
interface POItem {
  qty: number;
  itemCode: string;
  itemDescription: string;
  unitPrice?: number;
  totalPrice?: number;
}

interface DeliveryNote {
  id?: string;
  deliveryNumber: string;
  purchaseOrderNumber: string;
  shipTo: string;
  poDate: string;
  items: POItem[];
  totalAmount?: number;
  createdAt: Timestamp;
  createdBy: string;
}

// --- Constants ---
const COMPANY_NAME = "JES'CAMP GIFTS AND DECORATIONS LIMITED";
const COMPANY_ADDRESS = "P.O.BOX 1540 - 00100\nNAIROBI";
const COMPANY_KRA_PIN = "PO51783488Y";
const COMPANY_CONTACTS = "+254 720 416 772 / +254 720 427 535";
const COMPANY_EMAIL = "jescampltd@gmail.com";

const CUSTOMER_NAME = "NAIVAS LIMITED";
const CUSTOMER_ADDRESS = "P.O.BOX 61600 - 00200\nNAIROBI";
const CUSTOMER_KRA_PIN = "P051123223G";

const PURPLE_DARK = "#4C1D95"; // purple-900
const PURPLE_PRIMARY = "#6B21A8"; // purple-800
const ORANGE_PRIMARY = "#F97316"; // orange-500
const BG_DARK = "#111827"; // gray-900

const SILK_THEMES = [
  { name: 'Royal Velvet', color: '#A855F7', accent: '#6366F1', glow: 'bg-purple-600', text: 'text-purple-400', border: 'border-purple-500/30' },
  { name: 'Sunset Silk', color: '#F97316', accent: '#EF4444', glow: 'bg-orange-600', text: 'text-orange-400', border: 'border-orange-500/30' },
  { name: 'Midnight Satin', color: '#3B82F6', accent: '#1D4ED8', glow: 'bg-blue-600', text: 'text-blue-400', border: 'border-blue-500/30' },
  { name: 'Emerald Drapery', color: '#10B981', accent: '#059669', glow: 'bg-emerald-600', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  { name: 'Rose Cashmere', color: '#EC4899', accent: '#BE185D', glow: 'bg-pink-600', text: 'text-pink-400', border: 'border-pink-500/30' },
  { name: 'Gold Damask', color: '#F59E0B', accent: '#D97706', glow: 'bg-amber-600', text: 'text-amber-400', border: 'border-amber-500/30' }
];

// --- Gemini Setup ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const PO_EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    purchaseOrderNumber: { type: Type.STRING, description: "The purchase order number." },
    shipTo: { type: Type.STRING, description: "The Ship To detail/address." },
    poDate: { type: Type.STRING, description: "The P.O. Date (e.g., DD/MM/YYYY)." },
    totalAmount: { type: Type.NUMBER, description: "The total amount of the purchase order." },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          qty: { type: Type.NUMBER, description: "Quantity." },
          itemCode: { type: Type.STRING, description: "Item code or SKU." },
          itemDescription: { type: Type.STRING, description: "Description of the item." },
          unitPrice: { type: Type.NUMBER, description: "Unit price." },
          totalPrice: { type: Type.NUMBER, description: "Total price for this line." }
        },
        required: ["qty", "itemDescription"]
      }
    }
  },
  required: ["purchaseOrderNumber", "shipTo", "poDate", "items"]
};

// --- Components ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [currentNote, setCurrentNote] = useState<Partial<DeliveryNote> | null>(null);
  const [history, setHistory] = useState<DeliveryNote[]>([]);
  const [viewingNote, setViewingNote] = useState<DeliveryNote | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Background Waves states
  const [themeIndex, setThemeIndex] = useState(0);
  const [silkSpeed, setSilkSpeed] = useState(1.2);
  const [silkScale, setSilkScale] = useState(6.0); // bendRadius
  const [silkIntensity, setSilkIntensity] = useState(-3.5); // bendStrength
  const [silkLineCount, setSilkLineCount] = useState(12); // lineCount
  const [showSilkControls, setShowSilkControls] = useState(false);

  const isAdmin = user?.email === "dconlinebread01@gmail.com";

  useEffect(() => {
    const handleResize = () => {
      if (previewContainerRef.current && noteRef.current) {
        const containerWidth = previewContainerRef.current.offsetWidth;
        const noteWidth = 210 * 3.7795275591; // 210mm in pixels (approx)
        const newScale = Math.min(1, (containerWidth - 40) / noteWidth);
        setScale(newScale);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [currentNote, viewingNote]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "deliveryNotes"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const notes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DeliveryNote));
      setHistory(notes);
    });
    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!user || history.length === 0 || !isAdmin) return;

    const migrate = async () => {
      console.log("[Migration] Checking for notes to migrate...");
      let migrationCount = 0;
      for (const note of history) {
        // Flexible regex for old format
        const oldMatch = note.deliveryNumber.match(/JES\s*(\d+)\.(\d+)/i);
        if (oldMatch && note.id) {
          const m = parseInt(oldMatch[1]);
          const n = parseInt(oldMatch[2]);
          const newNum = formatDeliveryNumber(m, n);
          
          // Only update if it's actually different (e.g. JES 4.2 -> JES 0402)
          if (note.deliveryNumber !== newNum) {
            console.log(`[Migration] Migrating note ${note.id} from ${note.deliveryNumber} to ${newNum}`);
            try {
              await updateDoc(doc(db, "deliveryNotes", note.id), {
                deliveryNumber: newNum
              });
              migrationCount++;
            } catch (err) {
              console.error("[Migration] Error for note", note.id, err);
            }
          }
        }
      }
      if (migrationCount > 0) {
        console.log(`[Migration] Successfully migrated ${migrationCount} notes.`);
      }
    };

    migrate();
  }, [user, history.length, isAdmin]); // Run when history length or admin status changes

  // Keep viewingNote in sync with history (important for migration updates)
  useEffect(() => {
    if (viewingNote && history.length > 0) {
      const updatedNote = history.find(n => n.id === viewingNote.id);
      if (updatedNote && updatedNote.deliveryNumber !== viewingNote.deliveryNumber) {
        setViewingNote(updatedNote);
      }
    }
  }, [history, viewingNote]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login Error:", err);
      setError("Failed to login. Please try again.");
    }
  };

  const handleLogout = () => signOut(auth);

  const formatDeliveryNumber = (month: number, count: number) => {
    const mm = month.toString().padStart(2, '0');
    const nn = count.toString().padStart(2, '0');
    return `JES ${mm}${nn}`;
  };

  const displayDeliveryNumber = (num?: string) => {
    if (!num) return "";
    const oldMatch = num.match(/JES\s*(\d+)\.(\d+)/i);
    if (oldMatch) {
      const m = parseInt(oldMatch[1]);
      const n = parseInt(oldMatch[2]);
      return formatDeliveryNumber(m, n);
    }
    return num;
  };

  const getNextDeliveryNumber = async () => {
    const now = new Date();
    const month = now.getMonth() + 1; // 1-indexed
    
    console.log(`[Numbering] Generating next number for month: ${month}`);

    try {
      const q = query(
        collection(db, "deliveryNotes"),
        where("deliveryNumber", ">=", "JES"),
        where("deliveryNumber", "<=", "JES\uf8ff")
      );
      const snapshot = await getDocs(q);
      
      let maxCount = 0;
      snapshot.forEach(doc => {
        const data = doc.data();
        const numStr = (data.deliveryNumber as string).trim();
        
        // Parse both old (JES M.N or JESM.N) and new (JES MMNN or JESMMNN) formats
        // Using more flexible regex to handle potential missing spaces
        const oldMatch = numStr.match(/JES\s*(\d+)\.(\d+)/i);
        const newMatch = numStr.match(/JES\s*(\d{2})(\d{2})/i);
        
        if (oldMatch) {
          const m = parseInt(oldMatch[1]);
          const n = parseInt(oldMatch[2]);
          if (m === month) {
            if (n > maxCount) maxCount = n;
          }
        } else if (newMatch) {
          const m = parseInt(newMatch[1]);
          const n = parseInt(newMatch[2]);
          if (m === month) {
            if (n > maxCount) maxCount = n;
          }
        }
      });

      const nextNum = formatDeliveryNumber(month, maxCount + 1);
      console.log(`[Numbering] Next delivery number: ${nextNum}`);
      return nextNum;
    } catch (err) {
      console.error("[Numbering] Counter Error:", err);
      return formatDeliveryNumber(month, 1);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = reader.result as string;
        resolve(base64String.split(',')[1]);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const extractData = async () => {
    if (!selectedFile) return;
    setExtracting(true);
    setError(null);
    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("Gemini API key is not configured. Please check your settings.");
      }

      console.log(`[Extraction] Starting extraction for file: ${selectedFile.name} (${selectedFile.type})`);
      const base64 = await fileToBase64(selectedFile);
      
      const mimeType = selectedFile.type || (selectedFile.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

      const response: GenerateContentResponse = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview", // Switching to Flash Lite which has higher free-tier quotas (2,000/day vs 20/day)
        contents: { 
          parts: [
            {
              inlineData: {
                data: base64,
                mimeType: mimeType
              }
            },
            { text: "Extract the following data from this Purchase Order document: PO Number (starts with P), Ship To, PO Date, and a list of items (qty, code, description). Return the data in strict JSON format according to the provided schema." }
          ] 
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: PO_EXTRACTION_SCHEMA,
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error("AI returned an empty response. The document might be unreadable or too complex.");
      }

      console.log("[Extraction] AI Response received");
      
      // Clean JSON in case the model wraps it in markdown backticks despite the config
      const cleanedJson = text.replace(/```json\n?|```/g, "").trim();
      let data;
      try {
        data = JSON.parse(cleanedJson);
      } catch (parseErr) {
        console.error("[Extraction] JSON Parse Error:", parseErr, "Raw text:", text);
        throw new Error("Failed to parse the AI response. Please try again.");
      }

      const deliveryNumber = await getNextDeliveryNumber();

      // Ensure totals are calculated if Gemini missed them
      const processedItems = (data.items || []).map((item: any) => {
        const qty = item.qty || 0;
        const unitPrice = item.unitPrice || 0;
        return {
          ...item,
          totalPrice: item.totalPrice || Number((qty * unitPrice).toFixed(2))
        };
      });

      const calculatedTotal = processedItems.reduce((sum: number, item: any) => sum + (item.totalPrice || 0), 0);

      setCurrentNote({
        ...data,
        items: processedItems,
        totalAmount: data.totalAmount || Number(calculatedTotal.toFixed(2)),
        deliveryNumber,
        createdAt: Timestamp.now(),
        createdBy: user?.uid || "anonymous"
      });
      console.log("[Extraction] Extraction successful");
    } catch (err: any) {
      console.error("[Extraction] Error:", err);
      let errorMessage = "Failed to extract data. Please check the PO and try again.";
      
      const rawError = err.message || String(err);
      
      if (rawError.includes("RESOURCE_EXHAUSTED") || rawError.includes("429")) {
        errorMessage = "AI Quota Exceeded. You've reached the daily limit for automatic extraction. Please try again tomorrow or use the 'Manual Entry' option below.";
      } else if (rawError.includes("quota")) {
        errorMessage = "Daily extraction limit reached. Please wait or use manual entry.";
      }
      
      setError(errorMessage);
    } finally {
      setExtracting(false);
    }
  };

  const startManualEntry = async () => {
    setError(null);
    const deliveryNumber = await getNextDeliveryNumber();
    setCurrentNote({
      purchaseOrderNumber: "",
      shipTo: "",
      poDate: format(new Date(), 'dd/MM/yyyy'),
      items: [{ qty: 1, itemCode: "", itemDescription: "", unitPrice: 0, totalPrice: 0 }],
      totalAmount: 0,
      deliveryNumber,
      createdAt: Timestamp.now(),
      createdBy: user?.uid || "anonymous"
    });
    setIsEditing(true); // Allow immediate editing for manual entry
  };

  const saveNote = async () => {
    const note = currentNote || viewingNote;
    if (!note || !user) return;
    try {
      if (viewingNote && viewingNote.id) {
        // Update existing
        const { id, ...data } = viewingNote;
        await setDoc(doc(db, "deliveryNotes", id), {
          ...data,
          updatedAt: serverTimestamp()
        });
        setIsEditing(false);
      } else if (currentNote) {
        // Create new
        const docRef = await addDoc(collection(db, "deliveryNotes"), {
          ...currentNote,
          createdAt: serverTimestamp()
        });
        
        // Immediately set as viewing so user can print/download
        const newDoc = await getDoc(docRef);
        if (newDoc.exists()) {
          setViewingNote({ id: newDoc.id, ...newDoc.data() } as DeliveryNote);
        }
        
        setCurrentNote(null);
        setSelectedFile(null);
        setIsEditing(false);
      }
    } catch (err) {
      console.error("Save Error:", err);
      setError("Failed to save delivery note.");
    }
  };

  const downloadPDF = async () => {
    if (!noteRef.current) return;
    
    // Temporarily reset scale for capture if needed, or use onclone
    // Ensure we're at the top for capture
    window.scrollTo(0, 0);
    
    const canvas = await html2canvas(noteRef.current, { 
      scale: 2,
      useCORS: true,
      logging: false,
      onclone: (clonedDoc) => {
        const clonedElement = clonedDoc.getElementById('delivery-note-to-download');
        if (clonedElement instanceof HTMLElement) {
          clonedElement.style.transform = 'none';
          clonedElement.style.margin = '0';
          clonedElement.style.position = 'fixed';
          clonedElement.style.top = '0';
          clonedElement.style.left = '0';
          clonedElement.style.width = '210mm';
          clonedElement.style.height = '297mm';
          clonedElement.style.boxShadow = 'none';
          clonedElement.style.border = 'none';
          clonedElement.style.boxSizing = 'border-box';
        }
      }
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    pdf.addImage(imgData, 'PNG', 0, 0, 210, 297);
    const fileNameNum = displayDeliveryNumber(viewingNote?.deliveryNumber || currentNote?.deliveryNumber);
    pdf.save(`Delivery_Note_${fileNameNum}.pdf`);
  };

  const deleteNote = async (id: string) => {
    try {
      await deleteDoc(doc(db, "deliveryNotes", id));
      if (viewingNote?.id === id) setViewingNote(null);
      setDeletingId(null);
    } catch (err) {
      console.error("Delete Error:", err);
      setError("Failed to delete delivery note. Admin permissions required.");
      setDeletingId(null);
    }
  };

  const updateItem = (idx: number, field: keyof DeliveryNote['items'][0], value: string | number) => {
    const note = currentNote || viewingNote;
    if (!note || !note.items) return;

    const newItems = [...note.items];
    const updatedItem = { ...newItems[idx], [field]: value };
    
    // Recalculate line total
    if (field === 'qty' || field === 'unitPrice') {
      const qty = field === 'qty' ? Number(value) : updatedItem.qty;
      const unitPrice = field === 'unitPrice' ? Number(value) : (updatedItem.unitPrice || 0);
      updatedItem.totalPrice = Number((qty * unitPrice).toFixed(2));
    }
    
    newItems[idx] = updatedItem;

    // Recalculate grand total
    const totalAmount = Number(newItems.reduce((sum, item) => sum + (item.totalPrice || 0), 0).toFixed(2));

    if (currentNote) {
      setCurrentNote({ ...currentNote, items: newItems, totalAmount });
    } else if (viewingNote) {
      setViewingNote({ ...viewingNote, items: newItems, totalAmount });
    }
  };

  const removeItem = (idx: number) => {
    const note = currentNote || viewingNote;
    if (!note || !note.items) return;

    const newItems = note.items.filter((_, i) => i !== idx);

    if (currentNote) {
      setCurrentNote({ ...currentNote, items: newItems });
    } else if (viewingNote) {
      setViewingNote({ ...viewingNote, items: newItems });
    }
  };

  const addItem = () => {
    const note = currentNote || viewingNote;
    if (!note) return;

    const newItem = { qty: 1, itemCode: '', itemDescription: '' };
    const newItems = [...(note.items || []), newItem];

    if (currentNote) {
      setCurrentNote({ ...currentNote, items: newItems });
    } else if (viewingNote) {
      setViewingNote({ ...viewingNote, items: newItems });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-12 h-12 animate-spin text-purple-800" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 p-4 relative overflow-hidden">
        {/* Background Waves */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          <FloatingLines
            linesGradient={[SILK_THEMES[themeIndex].color, SILK_THEMES[themeIndex].accent]}
            enabledWaves={['top', 'middle', 'bottom']}
            lineCount={silkLineCount}
            lineDistance={6}
            bendRadius={silkScale}
            bendStrength={silkIntensity}
            interactive={true}
            parallax={true}
            animationSpeed={silkSpeed}
          />
        </div>

        {/* Background Accents */}
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none z-0">
          <div className={`absolute top-[-10%] left-[-10%] w-[40%] h-[40%] ${SILK_THEMES[themeIndex].glow} rounded-full blur-[120px]`} />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-orange-600 rounded-full blur-[120px]" />
        </div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-gray-900/50 backdrop-blur-xl rounded-3xl shadow-2xl p-10 text-center border border-gray-800 relative z-10"
        >
          <div className="w-24 h-24 bg-gradient-to-br from-purple-600 to-purple-900 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-lg shadow-purple-900/20 rotate-3">
            <span className="text-white font-black text-4xl">JC</span>
          </div>
          <h1 className="text-4xl font-black text-white mb-2 tracking-tight">Jes'Camp</h1>
          <p className="text-gray-400 mb-10 font-medium">Delivery Note Generator</p>
          <button 
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-4 bg-orange-600 hover:bg-orange-500 text-white font-bold py-4 px-8 rounded-2xl transition-all shadow-xl shadow-orange-900/20 group"
          >
            <LogIn className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col text-gray-100 relative overflow-hidden">
      {/* Background Waves */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <FloatingLines
          linesGradient={[SILK_THEMES[themeIndex].color, SILK_THEMES[themeIndex].accent]}
          enabledWaves={['top', 'middle', 'bottom']}
          lineCount={silkLineCount}
          lineDistance={6}
          bendRadius={silkScale}
          bendStrength={silkIntensity}
          interactive={true}
          parallax={true}
          animationSpeed={silkSpeed}
        />
      </div>

      {/* Background Accents */}
      <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none z-0">
        <div className={`absolute top-[-10%] left-[-10%] w-[40%] h-[40%] ${SILK_THEMES[themeIndex].glow} rounded-full blur-[120px]`} />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-orange-600 rounded-full blur-[120px]" />
      </div>

      {/* Header */}
      <header className="bg-gray-900/80 backdrop-blur-md border-b border-gray-800 px-8 py-5 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-tr from-purple-700 to-purple-900 rounded-xl flex items-center justify-center shadow-lg shadow-purple-900/40">
            <span className="text-white font-black text-2xl">JC</span>
          </div>
          <div>
            <h1 className="text-xl font-black text-white tracking-tight">Jes'Camp</h1>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Delivery System</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden md:block text-right">
            <p className="text-sm font-bold text-white">{user.displayName}</p>
            <p className="text-xs text-gray-500 font-medium">{user.email}</p>
          </div>
          <button 
            onClick={handleLogout}
            className="p-3 bg-gray-800 hover:bg-red-900/30 text-gray-400 hover:text-red-500 rounded-xl transition-all border border-gray-700"
            title="Logout"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-8 flex flex-col gap-8 relative z-10">
        {/* Modern Bento Stats Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
          {/* Stat 1 */}
          <div className="relative bg-gray-900/40 backdrop-blur-md border border-gray-800/80 hover:border-purple-500/30 transition-all duration-300 p-6 rounded-2xl flex items-center gap-4 overflow-hidden group">
            <div className="p-3.5 bg-purple-500/10 rounded-xl text-purple-400 group-hover:scale-110 transition-transform">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">Total Notes</p>
              <p className="text-2xl font-black text-white">{history.length}</p>
            </div>
            <div className="absolute -right-6 -bottom-6 w-16 h-16 bg-purple-500/5 rounded-full blur-xl pointer-events-none" />
          </div>

          {/* Stat 2 */}
          <div className="relative bg-gray-900/40 backdrop-blur-md border border-gray-800/80 hover:border-orange-500/30 transition-all duration-300 p-6 rounded-2xl flex items-center gap-4 overflow-hidden group">
            <div className="p-3.5 bg-orange-500/10 rounded-xl text-orange-400 group-hover:scale-110 transition-transform">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">Key Customer</p>
              <p className="text-lg font-black text-white truncate max-w-[150px]">{CUSTOMER_NAME}</p>
            </div>
            <div className="absolute -right-6 -bottom-6 w-16 h-16 bg-orange-500/5 rounded-full blur-xl pointer-events-none" />
          </div>

          {/* Stat 3 */}
          <div className="relative bg-gray-900/40 backdrop-blur-md border border-gray-800/80 hover:border-blue-500/30 transition-all duration-300 p-6 rounded-2xl flex items-center gap-4 overflow-hidden group">
            <div className="p-3.5 bg-blue-500/10 rounded-xl text-blue-400 group-hover:scale-110 transition-transform">
              <History className="w-5 h-5" />
            </div>
            <div className="truncate">
              <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">Latest Delivery</p>
              <p className="text-base font-black text-white truncate max-w-[150px]">
                {history[0] ? displayDeliveryNumber(history[0].deliveryNumber) : "No notes yet"}
              </p>
            </div>
            <div className="absolute -right-6 -bottom-6 w-16 h-16 bg-blue-500/5 rounded-full blur-xl pointer-events-none" />
          </div>

          {/* Stat 4 */}
          <div 
            className="relative bg-gray-900/40 backdrop-blur-md border border-gray-800/80 hover:border-emerald-500/30 transition-all duration-300 p-6 rounded-2xl flex items-center gap-4 overflow-hidden group cursor-pointer"
            onClick={() => setShowSilkControls(!showSilkControls)}
          >
            <div className={`p-3.5 bg-emerald-500/10 rounded-xl ${SILK_THEMES[themeIndex].text} group-hover:scale-110 transition-transform`}>
              <Palette className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">Ambient Canvas</p>
              <p className="text-base font-black text-white flex items-center gap-1.5">
                {SILK_THEMES[themeIndex].name}
                <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              </p>
            </div>
            <div className="absolute -right-6 -bottom-6 w-16 h-16 bg-emerald-500/5 rounded-full blur-xl pointer-events-none" />
          </div>
        </div>

        {/* Ambient Canvas Visual Customizer Panel */}
        <AnimatePresence>
          {showSilkControls && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="bg-gray-900/60 backdrop-blur-md border border-gray-800/90 rounded-2xl p-6 grid grid-cols-1 md:grid-cols-3 gap-6 relative">
                {/* Close Button */}
                <button
                  onClick={() => setShowSilkControls(false)}
                  className="absolute top-4 right-4 text-gray-500 hover:text-white font-bold transition-colors text-xs"
                >
                  ✕ Close
                </button>

                {/* Theme Selector */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Palette className="w-4 h-4 text-purple-400" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-gray-200">Wave Theme</h3>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {SILK_THEMES.map((t, idx) => (
                      <button
                        key={idx}
                        onClick={() => setThemeIndex(idx)}
                        className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border text-[10px] font-bold transition-all ${
                          themeIndex === idx
                            ? 'bg-purple-950/40 border-purple-500 text-white shadow-md shadow-purple-900/10'
                            : 'bg-gray-800/40 border-gray-800 hover:border-gray-700 text-gray-400 hover:text-gray-200'
                        }`}
                      >
                        <div className="w-4 h-4 rounded-full shadow-inner" style={{ backgroundColor: t.color }} />
                        <span className="truncate w-full text-center">{t.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sliders (Speed & Scale) */}
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-gray-200">
                        <Sliders className="w-4 h-4 text-purple-400" />
                        <span>Flow Speed</span>
                      </div>
                      <span className="text-[10px] font-mono text-gray-400">{silkSpeed.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="4.0"
                      step="0.1"
                      value={silkSpeed}
                      onChange={(e) => setSilkSpeed(parseFloat(e.target.value))}
                      className="w-full accent-purple-500 bg-gray-800 h-1.5 rounded-lg cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-gray-200">
                        <Sliders className="w-4 h-4 text-purple-400" />
                        <span>Bend Radius</span>
                      </div>
                      <span className="text-[10px] font-mono text-gray-400">{silkScale.toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min="1.0"
                      max="20.0"
                      step="0.5"
                      value={silkScale}
                      onChange={(e) => setSilkScale(parseFloat(e.target.value))}
                      className="w-full accent-purple-500 bg-gray-800 h-1.5 rounded-lg cursor-pointer"
                    />
                  </div>
                </div>

                {/* Advanced (Intensity & Rotation) */}
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-gray-200">
                        <Sparkles className="w-4 h-4 text-purple-400" />
                        <span>Bend Strength</span>
                      </div>
                      <span className="text-[10px] font-mono text-gray-400">{silkIntensity.toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min="-10.0"
                      max="-0.2"
                      step="0.1"
                      value={silkIntensity}
                      onChange={(e) => setSilkIntensity(parseFloat(e.target.value))}
                      className="w-full accent-purple-500 bg-gray-800 h-1.5 rounded-lg cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-gray-200">
                        <Sliders className="w-4 h-4 text-purple-400" />
                        <span>Wave Density</span>
                      </div>
                      <span className="text-[10px] font-mono text-gray-400">{silkLineCount} lines</span>
                    </div>
                    <input
                      type="range"
                      min="2"
                      max="30"
                      step="1"
                      value={silkLineCount}
                      onChange={(e) => setSilkLineCount(parseInt(e.target.value))}
                      className="w-full accent-purple-500 bg-gray-800 h-1.5 rounded-lg cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Core Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Left Column: Input & History */}
          <div className="lg:col-span-5 space-y-8">
          {/* Input Section */}
          <section className="bg-gray-900/50 backdrop-blur-sm rounded-3xl shadow-xl border border-gray-800 p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-orange-500/10 rounded-lg">
                <Plus className="w-6 h-6 text-orange-500" />
              </div>
              <h2 className="text-xl font-bold text-white">New Delivery Note</h2>
            </div>
            
            <div className="space-y-6">
              {/* File Upload */}
              <div className="relative">
                <input 
                  type="file" 
                  accept="application/pdf,image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setSelectedFile(file);
                    }
                  }}
                  className="hidden" 
                  id="po-upload"
                />
                <label 
                  htmlFor="po-upload"
                  className={`w-full flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${selectedFile ? 'border-purple-500 bg-purple-500/10' : 'border-gray-800 hover:border-purple-500/50 bg-gray-800/50'}`}
                >
                  <Upload className={`w-12 h-12 mb-4 ${selectedFile ? 'text-purple-500' : 'text-gray-600'}`} />
                  <span className="text-lg font-black text-gray-200">
                    {selectedFile ? selectedFile.name : 'Upload PO Document'}
                  </span>
                  <span className="text-xs text-gray-500 mt-3 font-bold uppercase tracking-widest">
                    PDF or Image supported
                  </span>
                </label>
                {selectedFile && (
                  <button 
                    onClick={() => setSelectedFile(null)}
                    className="absolute top-4 right-4 p-2 bg-gray-900 rounded-full text-gray-500 hover:text-red-500 transition-colors border border-gray-800"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <button 
              onClick={extractData}
              disabled={extracting || !selectedFile}
              className="w-full mt-8 flex items-center justify-center gap-3 bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400 disabled:from-gray-800 disabled:to-gray-800 text-white font-black py-5 px-8 rounded-2xl transition-all shadow-lg shadow-orange-900/20 group"
            >
              {extracting ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-6 h-6 group-hover:scale-110 transition-transform" />
                  Generate Note
                </>
              )}
            </button>
            {error && (
              <div className="mt-6 flex flex-col gap-4">
                <div className="p-4 bg-red-900/20 border border-red-900/50 text-red-400 rounded-xl flex items-center gap-3 text-sm font-medium">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
                {error.includes("Quota") && (
                  <button
                    onClick={startManualEntry}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gray-800 hover:bg-gray-700 text-gray-200 font-bold rounded-xl transition-all border border-gray-700 text-xs uppercase tracking-widest"
                  >
                    <Plus className="w-4 h-4" />
                    Fill Manually Instead
                  </button>
                )}
              </div>
            )}
          </section>

          {/* History Section */}
          <section className="bg-gray-900/50 backdrop-blur-sm rounded-3xl shadow-xl border border-gray-800 overflow-hidden">
            <div className="p-8 border-b border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-500/10 rounded-lg">
                  <History className="w-6 h-6 text-purple-500" />
                </div>
                <h2 className="text-xl font-bold text-white">Recent Notes</h2>
              </div>
              <span className="text-xs font-black bg-gray-800 text-gray-400 px-3 py-1.5 rounded-full uppercase tracking-widest border border-gray-700">
                {history.length} Notes
              </span>
            </div>
            <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
              {history.length === 0 ? (
                <div className="p-16 text-center">
                  <FileText className="w-16 h-16 text-gray-800 mx-auto mb-6 opacity-20" />
                  <p className="text-gray-500 text-sm font-medium">No history found</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {history.map((note) => (
                    <div
                      key={note.id}
                      className={`w-full p-6 text-left hover:bg-gray-800/50 transition-all flex items-center justify-between group ${viewingNote?.id === note.id ? 'bg-purple-900/20 border-l-4 border-purple-500' : 'border-l-4 border-transparent'}`}
                    >
                      <button
                        onClick={() => {
                          setViewingNote(note);
                          setCurrentNote(null);
                        }}
                        className="flex-1 text-left"
                      >
                        <p className="font-black text-white group-hover:text-purple-400 transition-colors text-lg tracking-tight">
                          {displayDeliveryNumber(note.deliveryNumber)}
                        </p>
                        <div className="flex flex-col gap-1 mt-2">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-bold text-gray-500 bg-gray-800 px-2 py-0.5 rounded uppercase tracking-tighter">PO: {note.purchaseOrderNumber}</span>
                            <span className="text-xs font-medium text-gray-600">
                              {note.createdAt ? format(note.createdAt.toDate(), 'MMM d, yyyy') : 'Pending...'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                            <span className="truncate max-w-[200px]">{note.shipTo}</span>
                            {note.totalAmount && (
                              <span className="text-orange-500 ml-auto">KES {note.totalAmount.toLocaleString()}</span>
                            )}
                          </div>
                        </div>
                      </button>
                      <div className="flex items-center gap-2">
                        {isAdmin && (
                          <div className="relative">
                            {deletingId === note.id ? (
                              <div className="flex items-center gap-1 bg-red-900/40 p-1 rounded-lg border border-red-500/50">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteNote(note.id!);
                                  }}
                                  className="px-2 py-1 bg-red-600 text-white text-[10px] font-black rounded hover:bg-red-500 transition-colors"
                                >
                                  Confirm
                                </button>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeletingId(null);
                                  }}
                                  className="px-2 py-1 bg-gray-700 text-gray-300 text-[10px] font-black rounded hover:bg-gray-600 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingId(note.id!);
                                }}
                                className="p-3 text-gray-600 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100 hover:bg-red-500/10 rounded-xl"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            )}
                          </div>
                        )}
                        <ChevronRight className="w-5 h-5 text-gray-700 group-hover:text-purple-500 transition-all" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right Column: Preview */}
        <div className="lg:col-span-7">
          <AnimatePresence mode="wait">
            {(currentNote || viewingNote) ? (
              <motion.div 
                key={viewingNote?.id || "current"}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {/* Actions */}
                <div className="flex items-center justify-between bg-gray-900 p-6 rounded-2xl shadow-xl border border-gray-800">
                  <div className="flex gap-3">
                    {viewingNote && !isEditing ? (
                      <>
                        <button 
                          onClick={downloadPDF}
                          className="flex items-center gap-2 bg-purple-700 hover:bg-purple-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-purple-900/20"
                        >
                          <Download className="w-5 h-5" />
                          Export PDF
                        </button>
                        <button 
                          onClick={() => window.print()}
                          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 px-6 py-2.5 rounded-xl text-sm font-bold transition-all border border-gray-700"
                        >
                          <Printer className="w-5 h-5" />
                          Print
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-2 px-4 py-2 bg-gray-800/50 border border-gray-700 rounded-xl text-gray-500 text-xs font-bold italic">
                        <AlertCircle className="w-4 h-4" />
                        Save to enable Print/Download
                      </div>
                    )}
                    <button 
                      onClick={() => setIsEditing(!isEditing)}
                      className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all border ${isEditing ? 'bg-orange-500/20 border-orange-500 text-orange-500' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}
                    >
                      <Edit3 className="w-5 h-5" />
                      {isEditing ? 'Finish Editing' : 'Edit Note'}
                    </button>
                  </div>
                  {(currentNote || (viewingNote && isEditing)) && (
                    <button 
                      onClick={saveNote}
                      className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white px-8 py-2.5 rounded-xl text-sm font-black shadow-xl shadow-orange-900/20 transition-all"
                    >
                      <CheckCircle2 className="w-5 h-5" />
                      {viewingNote ? 'Update Changes' : 'Save & Register'}
                    </button>
                  )}
                  {viewingNote && (
                    <button 
                      onClick={() => {
                        setViewingNote(null);
                        setCurrentNote(null);
                      }}
                      className="text-sm text-gray-500 hover:text-white font-bold transition-colors"
                    >
                      Close Preview
                    </button>
                  )}
                </div>

                {/* Delivery Note Template */}
                <div 
                  className="overflow-hidden pb-4 flex justify-center" 
                  ref={previewContainerRef}
                  style={{ height: scale < 1 ? `calc(297mm * ${scale} + 20px)` : 'auto' }}
                >
                  <div 
                    ref={noteRef}
                    id="delivery-note-to-download"
                    className="mx-auto w-[210mm] h-[297mm] flex flex-col font-sans border print:m-0 print:shadow-none print:border-none relative overflow-hidden origin-top print-only"
                      style={{ 
                        backgroundColor: '#ffffff',
                        borderColor: '#e5e7eb',
                        color: '#1a1a1a',
                        padding: '10mm 12mm',
                        boxSizing: 'border-box',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                        transform: `scale(${scale})`
                      }}
                  >
                    {/* Subtle Watermark */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none rotate-[-45deg]" style={{ opacity: 0.02 }}>
                      <h1 className="text-[180px] font-display font-black whitespace-nowrap tracking-tighter" style={{ color: '#1a1a1a' }}>JES'CAMP</h1>
                    </div>

                    {/* Centered Branded Header */}
                    <div className="flex flex-col items-center text-center mb-4 border-b-2 pb-3 relative z-10" style={{ borderBottomColor: '#4c1d95' }}>
                      <div className="flex items-center gap-4 mb-2">
                        <h1 className="text-4xl font-display font-black leading-none tracking-tight" style={{ color: '#4c1d95' }}>
                          Jes'Camp <span className="font-bold" style={{ color: '#f97316' }}>Limited</span>
                        </h1>
                      </div>
                      <p className="text-[10px] font-black uppercase tracking-[0.4em] mb-4" style={{ color: '#6b7280' }}>Gifts & Decorations Specialist</p>
                      
                      <div className="w-full flex justify-between items-center px-6">
                        <h2 className="text-2xl font-display font-black italic uppercase leading-none" style={{ color: '#9ca3af', letterSpacing: '0.1em' }}>Delivery Note</h2>
                        
                        <div className="flex items-center gap-8 py-1.5 px-5 rounded-xl border" style={{ borderColor: '#f3f4f6', backgroundColor: 'rgba(249, 250, 251, 0.5)' }}>
                          <div className="flex flex-col items-center">
                            <span className="text-[8px] font-black uppercase tracking-[0.1em]" style={{ color: '#9ca3af' }}>Number</span>
                            <span className="text-base font-black tracking-tighter" style={{ color: '#4c1d95' }}>
                              {displayDeliveryNumber((viewingNote || currentNote)?.deliveryNumber)}
                            </span>
                          </div>
                          <div className="w-px h-6 bg-gray-200"></div>
                          <div className="flex flex-col items-center">
                            <span className="text-[8px] font-black uppercase tracking-[0.1em]" style={{ color: '#9ca3af' }}>Date</span>
                            <span className="text-[12px] font-black" style={{ color: '#1f2937' }}>
                              {(() => {
                                const date = (viewingNote || currentNote)?.createdAt;
                                return date ? format(date.toDate(), 'dd MMM yyyy') : format(new Date(), 'dd MMM yyyy');
                              })()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Address Grid */}
                    <div className="grid grid-cols-2 gap-6 mb-4 relative z-10">
                      <div className="p-3 rounded-2xl border-2" style={{ backgroundColor: 'rgba(249, 250, 251, 0.5)', borderColor: '#f3f4f6' }}>
                        <h3 className="text-[9px] font-display font-black uppercase tracking-widest mb-2 flex items-center gap-2" style={{ color: '#4c1d95' }}>
                          <div className="w-1 h-1 rounded-full" style={{ backgroundColor: '#4c1d95' }}></div>
                          From: Supplier
                        </h3>
                        <div className="space-y-0.5">
                          <p className="font-black text-[11px]" style={{ color: '#111827' }}>{COMPANY_NAME}</p>
                          <p className="text-[9px] leading-tight whitespace-pre-line" style={{ color: '#4b5563' }}>{COMPANY_ADDRESS}</p>
                          <div className="pt-1.5 flex items-center gap-2 border-t mt-1.5" style={{ borderTopColor: '#e5e7eb' }}>
                            <span className="text-[7px] font-black uppercase" style={{ color: '#9ca3af' }}>K.R.A PIN:</span>
                            <span className="text-[8px] font-bold" style={{ color: '#1f2937' }}>{COMPANY_KRA_PIN}</span>
                          </div>
                        </div>
                      </div>
                      <div className="p-3 rounded-2xl border-2" style={{ backgroundColor: 'rgba(249, 250, 251, 0.5)', borderColor: '#f3f4f6' }}>
                        <h3 className="text-[9px] font-display font-black uppercase tracking-widest mb-2 flex items-center gap-2" style={{ color: '#f97316' }}>
                          <div className="w-1 h-1 rounded-full" style={{ backgroundColor: '#f97316' }}></div>
                          To: Customer
                        </h3>
                        <div className="space-y-0.5">
                          <p className="font-black text-[11px] uppercase" style={{ color: '#111827' }}>{CUSTOMER_NAME}</p>
                          <p className="text-[9px] leading-tight whitespace-pre-line" style={{ color: '#4b5563' }}>{CUSTOMER_ADDRESS}</p>
                          <div className="pt-1.5 flex items-center gap-2 border-t mt-1.5" style={{ borderTopColor: '#e5e7eb' }}>
                            <span className="text-[7px] font-black uppercase" style={{ color: '#9ca3af' }}>K.R.A PIN:</span>
                            <span className="text-[8px] font-bold" style={{ color: '#1f2937' }}>{CUSTOMER_KRA_PIN}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Order Info Bar */}
                    <div className="grid grid-cols-3 gap-0 border-2 rounded-xl overflow-hidden mb-4 relative z-10" style={{ borderColor: '#4c1d95' }}>
                      <div className="p-2 border-r-2" style={{ borderRightColor: '#4c1d95', backgroundColor: 'rgba(245, 243, 255, 0.3)' }}>
                        <p className="text-[8px] font-display font-black uppercase tracking-widest mb-1" style={{ color: '#a78bfa' }}>Purchase Order No.</p>
                        <p className="text-[11px] font-black" style={{ color: '#4c1d95' }}>{(viewingNote || currentNote)?.purchaseOrderNumber}</p>
                      </div>
                      <div className="p-2 border-r-2" style={{ borderRightColor: '#4c1d95' }}>
                        <p className="text-[8px] font-display font-black uppercase tracking-widest mb-1" style={{ color: '#9ca3af' }}>P.O. Date</p>
                        <p className="text-[11px] font-bold" style={{ color: '#1f2937' }}>{(viewingNote || currentNote)?.poDate}</p>
                      </div>
                      <div className="p-2">
                        <p className="text-[8px] font-display font-black uppercase tracking-widest mb-1" style={{ color: '#9ca3af' }}>Ship To Location</p>
                        <p className="text-[11px] font-bold" style={{ color: '#1f2937' }}>{(viewingNote || currentNote)?.shipTo}</p>
                      </div>
                    </div>

                    {/* Items Table */}
                    <div className="relative z-10 mb-2 flex-1">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr style={{ backgroundColor: '#4c1d95', color: '#ffffff' }}>
                            <th className="py-1.5 px-4 text-left text-[10px] font-display font-black uppercase tracking-widest w-16 rounded-tl-lg">Qty</th>
                            <th className="py-1.5 px-4 text-left text-[10px] font-display font-black uppercase tracking-widest w-32">Item Code</th>
                            <th className="py-1.5 px-4 text-left text-[10px] font-display font-black uppercase tracking-widest rounded-tr-lg">Description</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y border-x border-b" style={{ borderColor: '#f3f4f6', borderBottomColor: '#f3f4f6' }}>
                          {(viewingNote || currentNote)?.items?.map((item, idx) => (
                            <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : 'rgba(249, 250, 251, 0.3)' }}>
                              <td className="py-1.5 px-4 text-[11px] font-black" style={{ color: '#111827' }}>
                                {isEditing ? (
                                  <input 
                                    type="number"
                                    value={item.qty}
                                    onChange={(e) => updateItem(idx, 'qty', parseInt(e.target.value) || 0)}
                                    className="w-full bg-purple-50 border border-purple-100 rounded px-2 py-0.5 text-[10px] font-black focus:outline-none focus:ring-2 focus:ring-purple-500"
                                  />
                                ) : item.qty}
                              </td>
                              <td className="py-1.5 px-4 text-[10px] font-bold" style={{ color: '#6b7280' }}>
                                {isEditing ? (
                                  <input 
                                    type="text"
                                    value={item.itemCode}
                                    onChange={(e) => updateItem(idx, 'itemCode', e.target.value)}
                                    className="w-full bg-purple-50 border border-purple-100 rounded px-2 py-0.5 text-[9px] font-bold focus:outline-none focus:ring-2 focus:ring-purple-500"
                                  />
                                ) : item.itemCode}
                              </td>
                              <td className="py-1.5 px-4 text-[10px] font-medium" style={{ color: '#1f2937' }}>
                                <div className="flex items-center justify-between gap-2">
                                  {isEditing ? (
                                    <input 
                                      type="text"
                                      value={item.itemDescription}
                                      onChange={(e) => updateItem(idx, 'itemDescription', e.target.value)}
                                      className="w-full bg-purple-50 border border-purple-100 rounded px-2 py-0.5 text-[9px] font-medium focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                  ) : item.itemDescription}
                                  {isEditing && (
                                    <button 
                                      onClick={() => removeItem(idx)}
                                      className="p-1 text-red-400 hover:text-red-600 transition-colors"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                          {/* Fill empty rows */}
                          {isEditing && (
                            <tr>
                              <td colSpan={3} className="py-1.5 px-4">
                                <button 
                                  onClick={addItem}
                                  className="w-full flex items-center justify-center gap-2 py-1 border-2 border-dashed border-purple-200 text-purple-400 hover:border-purple-400 hover:text-purple-600 rounded-lg transition-all font-bold text-[9px] uppercase tracking-widest"
                                >
                                  <Plus className="w-4 h-4" />
                                  Add Item Row
                                </button>
                              </td>
                            </tr>
                          )}
                          {Array.from({ length: Math.max(0, (isEditing ? 5 : 8) - ((viewingNote || currentNote)?.items?.length || 0)) }).map((_, idx) => (
                            <tr key={`empty-${idx}`}>
                              <td className="py-1.5 px-4 h-8"></td>
                              <td className="py-1.5 px-4 h-8"></td>
                              <td className="py-1.5 px-4 h-8"></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>


                    {/* Signatures & Footer */}
                    <div className="mt-4 pt-4 border-t-2 relative z-10" style={{ borderTopColor: '#f3f4f6' }}>
                      <div className="grid grid-cols-2 gap-12 mb-4">
                        {/* Jes'Camp Signature */}
                        <div className="space-y-4">
                          <div className="border-b-2 pb-2 relative" style={{ borderBottomColor: '#e5e7eb' }}>
                            <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: '#9ca3af' }}>Authorized Signature</p>
                            <div className="absolute -top-8 right-0 opacity-10">
                              <div className="w-16 h-16 border-4 border-dashed rounded-full flex items-center justify-center font-black text-[10px] rotate-12" style={{ borderColor: '#4c1d95', color: '#4c1d95' }}>OFFICIAL STAMP</div>
                            </div>
                          </div>
                          <div className="flex justify-between items-center">
                            <p className="text-[8px] font-display font-black uppercase tracking-tight" style={{ color: '#4c1d95' }}>For Jes'Camp Limited</p>
                            <p className="text-[8px] font-bold italic" style={{ color: '#9ca3af' }}>Date: ____/____/20____</p>
                          </div>
                        </div>
                        {/* Customer Signature */}
                        <div className="space-y-4">
                          <div className="border-b-2 pb-2" style={{ borderBottomColor: '#e5e7eb' }}>
                            <p className="text-[7px] font-black uppercase tracking-widest" style={{ color: '#9ca3af' }}>Received By (Customer Signature & Stamp)</p>
                          </div>
                          <p className="text-[8px] font-bold italic" style={{ color: '#9ca3af' }}>Date: ____/____/20____</p>
                        </div>
                      </div>

                      <div className="flex justify-between items-end text-[8px] font-bold uppercase tracking-widest" style={{ color: '#9ca3af' }}>
                        <div className="flex gap-6">
                          <div className="space-y-1">
                            <p className="text-[9px] font-black" style={{ color: '#111827' }}>Contact</p>
                            <p>{COMPANY_CONTACTS}</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[9px] font-black" style={{ color: '#111827' }}>Email</p>
                            <p>{COMPANY_EMAIL}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] font-display font-black mb-1 tracking-tight" style={{ color: '#4c1d95' }}>Thank you for your business!</p>
                          <p className="text-[6px]">Jes'Camp Limited &copy; {new Date().getFullYear()}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center bg-gray-900/50 rounded-3xl border-2 border-dashed border-gray-800 p-16 text-center">
                <div className="w-32 h-32 bg-gray-800 rounded-full flex items-center justify-center mb-8 shadow-inner">
                  <FileText className="w-16 h-16 text-gray-700" />
                </div>
                <h3 className="text-2xl font-black text-white mb-3 tracking-tight">Ready to Generate</h3>
                <p className="text-gray-500 max-w-sm font-medium">
                  Upload a Purchase Order or select a previous note to see the professional template here.
                </p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  </div>
);
}
