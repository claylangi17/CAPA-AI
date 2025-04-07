document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Element References ---
    const capaForm = document.getElementById('capa-form');
    const photoInput = document.getElementById('defect-photo');
    const photoPreview = document.getElementById('photo-preview');
    const capaResultDiv = document.getElementById('capa-result');
    const reportContentDiv = document.getElementById('report-content');
    const downloadPdfButton = document.getElementById('download-pdf-button');
    const loadingIndicator = document.getElementById('loading-indicator');
    const generateButton = document.getElementById('generate-button');
    const apiStatusDiv = document.getElementById('api-status');
    
    // History Elements
    const historyButton = document.getElementById('history-button');
    const historyContainer = document.getElementById('history-container');
    const historyList = document.getElementById('history-list');
    const clearHistoryButton = document.getElementById('clear-history-button');
    
    // Log DOM elements to help debug
    console.log("History elements:", { 
        historyButton, 
        historyContainer, 
        historyList, 
        clearHistoryButton 
    });

    // --- State Variables ---
    let uploadedImageBase64 = null; // To store the uploaded image data for PDF

    // --- Constants ---
    const HISTORY_KEY = 'capaHistory';
    const MAX_HISTORY_ITEMS = 10; // Limit history size
    const HISTORY_CONTEXT_COUNT = 3; // Number of recent reports to send to AI

    // --- Initialize History Functionality ---
    if (historyButton && historyContainer) {
        historyButton.addEventListener('click', () => {
            console.log("History button clicked");
            const isVisible = historyContainer.style.display === 'block';
            if (isVisible) {
                historyContainer.style.display = 'none';
                historyButton.textContent = 'Lihat Riwayat';
            } else {
                displayHistory(); // Load and display history
                historyContainer.style.display = 'block';
                historyButton.textContent = 'Sembunyikan Riwayat';
            }
        });
    } else {
        console.error("History button or container not found in the DOM! Button:", historyButton, "Container:", historyContainer);
    }

    if (clearHistoryButton) {
        clearHistoryButton.addEventListener('click', clearHistory);
    } else {
        console.error("Clear history button not found in the DOM!");
    }

    // --- Image Preview ---
    photoInput.addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                photoPreview.src = e.target.result;
                photoPreview.style.display = 'block';
                uploadedImageBase64 = e.target.result; // Store base64 for later use
            }
            reader.readAsDataURL(file);
        } else {
            photoPreview.style.display = 'none';
            photoPreview.src = '#';
            uploadedImageBase64 = null;
        }
    });

    // --- Form Submission ---
    capaForm.addEventListener('submit', async function(event) {
        event.preventDefault(); // Prevent default form submission

        // Show loading indicator and disable button
        loadingIndicator.style.display = 'block';
        capaResultDiv.style.display = 'none'; // Hide previous results
        apiStatusDiv.style.display = 'none'; // Hide any previous API status messages
        generateButton.disabled = true;
        generateButton.textContent = 'Generating...';


        const formData = new FormData(capaForm);
        const data = Object.fromEntries(formData.entries());
        data.defect_photo_filename = photoInput.files[0]?.name || 'N/A'; // Add filename

        console.log("Form Data Submitted:", data); // For debugging

        let aiResponse = null;
        let usingFallback = false;

        try {
            // Try to get AI-generated content
            console.log("Attempting to call AI service...");
            aiResponse = await generateCapaWithAI(data);

            // Check if we got valid data from the AI service
            if (!aiResponse || !aiResponse.rootCauseAnalysis || aiResponse.rootCauseAnalysis.includes("tidak tersedia") ||
                aiResponse.rootCauseAnalysis.includes("kesalahan")) {
                throw new Error("Invalid or empty AI response");
            }

            console.log("Successfully received AI response:", aiResponse);

            // Save the successful report (input + AI output) to history
            saveReportToHistory(data, aiResponse);

        } catch (error) {
            console.error("Error generating CAPA with AI:", error);
            usingFallback = true;

            // Use fallback data if API call fails
            aiResponse = {
                rootCauseAnalysis: "Berdasarkan analisis, masalah ini disebabkan oleh pengaturan mesin yang tidak optimal dan kurangnya pemeliharaan rutin pada komponen utama.",
                correctiveActions: "• Lakukan kalibrasi ulang pada mesin\n• Ganti komponen yang aus\n• Sesuaikan pengaturan suhu operasional",
                preventiveActions: "• Buat jadwal pemeliharaan preventif setiap 2 minggu\n• Latih operator untuk mengenali tanda-tanda awal kerusakan\n• Dokumentasikan semua pengaturan optimal untuk referensi",
                pic: "Kepala Departemen Produksi",
                deadline: "2 minggu dari sekarang"
            };

            // Show API status notification
            apiStatusDiv.style.display = 'block';
        } finally {
            // Display the result, whether from AI or fallback
            console.log("Displaying results with " + (usingFallback ? "fallback data" : "AI data"));
            displayCapaResult(aiResponse, data);
            capaResultDiv.style.display = 'block';

            // Hide loading indicator and re-enable button
            loadingIndicator.style.display = 'none';
            generateButton.disabled = false;
            generateButton.textContent = 'Generate CAPA';
        }
    });

    // --- AI Generation Function (Using Google Gemini) ---
    async function generateCapaWithAI(inputData) {
        console.log("Calling Google Gemini API... Input:", inputData);
        const apiKey = "AIzaSyD-kzMeflflFAQ467baQGL8sSgiB2JL7Lg"; // Your Gemini API Key
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

        // --- Get recent history for context ---
        const history = getHistory();
        let historyContext = "";
        if (history.length > 0) {
            historyContext = "\n\nBerikut adalah beberapa ringkasan laporan CAPA sebelumnya untuk referensi (masalah -> analisis akar masalah):\n";
            const recentHistory = history.slice(0, HISTORY_CONTEXT_COUNT); // Get last N items
            recentHistory.forEach((item, index) => {
                // Limit context length per item
                const problemDescSnippet = item.input.problem_description.substring(0, 100) + (item.input.problem_description.length > 100 ? '...' : '');
                const rootCauseSnippet = item.output.rootCauseAnalysis.substring(0, 150) + (item.output.rootCauseAnalysis.length > 150 ? '...' : '');
                historyContext += `${index + 1}. Masalah (${item.input.event_date}): ${problemDescSnippet} -> Analisis: ${rootCauseSnippet}\n`;
            });
             historyContext += "\nGunakan riwayat ini sebagai konteks tambahan jika relevan.\n";
        }
        // --- End History Context ---

        // Construct the prompt for Gemini (requesting Indonesian output, including history context)
        const prompt = `
        Buatkan analisis laporan CAPA untuk perusahaan pengemasan berdasarkan detail berikut. Berikan output dalam format objek JSON dengan kunci: "rootCauseAnalysis", "correctiveActions", "preventiveActions", "pic", "deadline". Pastikan semua nilai dalam JSON menggunakan Bahasa Indonesia. Pertimbangkan juga riwayat laporan sebelumnya jika relevan.

        Detail Laporan Saat Ini:
        - Nama Operator: ${inputData.operator_name}
        - Tanggal: ${inputData.event_date}
        - Mesin: ${inputData.machine_name}
        - Lokasi: ${inputData.location}
        - Jenis Masalah: ${inputData.problem_type}
        - Deskripsi Masalah: ${inputData.problem_description}
        - Tindakan Awal: ${inputData.initial_action}

        Format Output yang Diperlukan (JSON dalam Bahasa Indonesia):
        {
          "rootCauseAnalysis": "...",
          "correctiveActions": ["...", "..."],
          "preventiveActions": ["...", "..."],
          "pic": "...",
          "deadline": "..."
        }
        ${historyContext}
        `;

        const requestBody = {
            contents: [{
                parts: [{
                    text: prompt
                }]
            }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 2000
            }
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error("Gemini API Error Response:", errorBody);
                throw new Error(`Gemini API request failed with status ${response.status}`);
            }

            const responseData = await response.json();
            console.log("Gemini API Raw Response:", responseData); // For debugging

            // Extract the text content, which should be the JSON string
            const generatedText = responseData.candidates[0]?.content?.parts[0]?.text;

            if (!generatedText) {
                 throw new Error("Could not extract generated text from Gemini response.");
            }

            console.log("Generated text from Gemini:", generatedText);

            // Attempt to parse the JSON string from the response, removing potential Markdown fences
            try {
                 let cleanedText = generatedText.trim();

                 // More robust JSON extraction
                 const jsonMatch = cleanedText.match(/```(?:json)?([\s\S]*?)```/) ||
                                   cleanedText.match(/{[\s\S]*?}/);

                 if (jsonMatch) {
                     cleanedText = jsonMatch[0].startsWith('{') ? jsonMatch[0] : jsonMatch[1].trim();
                 }

                 // Make sure we have a JSON object
                 if (!cleanedText.startsWith('{')) {
                     cleanedText = cleanedText.substring(cleanedText.indexOf('{'));
                 }
                 if (!cleanedText.endsWith('}')) {
                     cleanedText = cleanedText.substring(0, cleanedText.lastIndexOf('}') + 1);
                 }

                 console.log("Cleaned JSON text:", cleanedText);

                 const aiResult = JSON.parse(cleanedText.trim());
                 console.log("Parsed AI Result:", aiResult);

                 // Handle potential array values for actions
                 const formatArray = (arr) => {
                     if (Array.isArray(arr)) {
                         // Join with bullet points for display
                         return arr.map(item => `• ${item}`).join('\n');
                     }
                     return arr || '';
                 };

                 const validatedResult = {
                    rootCauseAnalysis: aiResult.rootCauseAnalysis || "Analisis akar masalah tidak tersedia.",
                    correctiveActions: formatArray(aiResult.correctiveActions) || "Tindakan korektif tidak tersedia.",
                    preventiveActions: formatArray(aiResult.preventiveActions) || "Tindakan preventif tidak tersedia.",
                    pic: aiResult.pic || "PIC belum ditentukan",
                    deadline: aiResult.deadline || "Deadline belum ditentukan"
                 };

                 console.log("Formatted result for display:", validatedResult);

                 // Basic validation (check if essential fields were present in the original parsed object)
                 if (!aiResult.rootCauseAnalysis || !aiResult.correctiveActions || !aiResult.preventiveActions || !aiResult.pic || !aiResult.deadline) {
                    console.warn("Original Gemini response missing expected fields. Used defaults where possible.");
                 }
                 return validatedResult; // Return the object with potentially formatted arrays
            } catch (parseError) {
                console.error("Error parsing JSON from Gemini response:", parseError, "Raw Text:", generatedText);
                // Handle cases where the response isn't valid JSON - provide fallback values
                return {
                    rootCauseAnalysis: "Analisis akar masalah tidak dapat diproses. Silakan isi secara manual.",
                    correctiveActions: "Tindakan korektif tidak dapat diproses. Silakan isi secara manual.",
                    preventiveActions: "Tindakan preventif tidak dapat diproses. Silakan isi secara manual.",
                    pic: "PIC belum ditentukan",
                    deadline: "Deadline belum ditentukan"
                };
            }

        } catch (error) {
            console.error("Error calling Gemini API:", error);
            // Return a default error object
            return {
                rootCauseAnalysis: "Terjadi kesalahan saat menghubungi AI. Silakan isi secara manual.",
                correctiveActions: "Terjadi kesalahan saat menghubungi AI. Silakan isi secara manual.",
                preventiveActions: "Terjadi kesalahan saat menghubungi AI. Silakan isi secara manual.",
                pic: "PIC belum ditentukan",
                deadline: "Deadline belum ditentukan"
            };
        }
    }

    // --- History Functions ---
    function getHistory() {
        const historyJson = localStorage.getItem(HISTORY_KEY);
        try {
            return historyJson ? JSON.parse(historyJson) : [];
        } catch (e) {
            console.error("Error parsing history from localStorage:", e);
            return []; // Return empty array on error
        }
    }

    function saveReportToHistory(inputData, outputData) {
        const history = getHistory();
        const newHistoryItem = {
            id: Date.now(), // Simple unique ID
            timestamp: new Date().toISOString(),
            input: inputData,
            output: outputData
        };

        // Add new item to the beginning
        history.unshift(newHistoryItem);

        // Limit history size
        if (history.length > MAX_HISTORY_ITEMS) {
            history.pop(); // Remove the oldest item
        }

        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
            console.log("Report saved to history.");
        } catch (e) {
            console.error("Error saving history to localStorage:", e);
            // Potentially notify user if storage is full or blocked
        }
    }

    // Function to populate the form with history data
    function fillFormWithHistory(inputData) {
        // Fill form fields with data from history
        document.getElementById('operator-name').value = inputData.operator_name || '';
        document.getElementById('event-date').value = inputData.event_date || '';
        document.getElementById('machine-name').value = inputData.machine_name || '';
        document.getElementById('location').value = inputData.location || '';
        document.getElementById('problem-type').value = inputData.problem_type || '';
        document.getElementById('problem-description').value = inputData.problem_description || '';
        document.getElementById('initial-action').value = inputData.initial_action || '';
        
        // Note: We can't restore the image from history as we're not storing the base64 data long-term
        // That would consume too much localStorage space
        photoPreview.style.display = 'none';
        uploadedImageBase64 = null;
    }

    // Create sample history data for testing
    function createSampleHistory() {
        const sampleData = [
            {
                id: Date.now() - 86400000, // Yesterday
                timestamp: new Date(Date.now() - 86400000).toISOString(),
                input: {
                    operator_name: "Budi Santoso",
                    event_date: "2023-08-15",
                    machine_name: "Printer X2000",
                    location: "Lantai 2, Area Produksi",
                    problem_type: "Printing",
                    problem_description: "Hasil cetakan tidak rata dan terdapat bercak tinta di beberapa area.",
                    initial_action: "Melakukan pembersihan pada print head dan roller.",
                    defect_photo_filename: "print_defect.jpg"
                },
                output: {
                    rootCauseAnalysis: "Analisis menunjukkan bahwa masalah disebabkan oleh tekanan roller yang tidak merata dan tinta yang mulai mengering di beberapa nozzle print head.",
                    correctiveActions: "• Melakukan pembersihan print head secara menyeluruh\n• Mengganti roller yang aus\n• Menyesuaikan tekanan pada sistem roller",
                    preventiveActions: "• Membuat jadwal pembersihan rutin print head setiap 3 hari\n• Memastikan tinta selalu dalam kondisi baik\n• Pelatihan operator tentang tanda-tanda awal masalah printing",
                    pic: "Kepala Bagian Printing",
                    deadline: "25 Agustus 2023"
                }
            },
            {
                id: Date.now() - 172800000, // 2 days ago
                timestamp: new Date(Date.now() - 172800000).toISOString(),
                input: {
                    operator_name: "Diana Wijaya",
                    event_date: "2023-08-14",
                    machine_name: "Cutting Machine C500",
                    location: "Lantai 1, Area Pemotongan",
                    problem_type: "Cutting",
                    problem_description: "Pemotongan tidak presisi, dengan deviasi ukuran hingga 3mm dari spesifikasi.",
                    initial_action: "Mengecek ketajaman pisau dan melakukan kalibrasi ulang.",
                    defect_photo_filename: "cutting_defect.jpg"
                },
                output: {
                    rootCauseAnalysis: "Pisau pemotong sudah tumpul dan terdapat ketidaksesuaian pada sistem kalibrasi mesin. Selain itu, terdapat beberapa komponen yang aus mengurangi stabilitas mesin saat beroperasi.",
                    correctiveActions: "• Mengganti pisau pemotong dengan yang baru\n• Melakukan kalibrasi ulang dengan alat ukur presisi\n• Memeriksa dan memperbaiki sistem tension control",
                    preventiveActions: "• Membuat jadwal penggantian pisau secara berkala\n• Pemeriksaan kalibrasi mingguan\n• Menyiapkan pisau cadangan untuk penggantian cepat",
                    pic: "Supervisor Produksi",
                    deadline: "20 Agustus 2023"
                }
            }
        ];

        // Check if history already exists
        const currentHistory = getHistory();
        if (currentHistory.length === 0) {
            try {
                localStorage.setItem(HISTORY_KEY, JSON.stringify(sampleData));
                console.log("Sample history data created successfully!");
                return true;
            } catch (e) {
                console.error("Error creating sample history:", e);
                return false;
            }
        }
        return false; // No sample data created because history already exists
    }

    // Call this when no history exists to create sample data
    if (getHistory().length === 0) {
        createSampleHistory();
    }

    function displayHistory() {
        if (!historyList) {
            console.error("History list element not found!");
            return;
        }

        const history = getHistory();
        historyList.innerHTML = ''; // Clear existing list

        if (history.length === 0) {
            historyList.innerHTML = '<li style="text-align: center; color: #777; padding: 20px;">Tidak ada riwayat.</li>';
            return;
        }

        history.forEach(item => {
            const li = document.createElement('li');
            li.dataset.historyId = item.id; // Store ID for potential future use (e.g., load item)

            const displayDate = new Date(item.timestamp).toLocaleString('id-ID', {
                dateStyle: 'medium', timeStyle: 'short'
            });

            li.innerHTML = `
                <span class="history-item-date">${displayDate}</span>
                <span class="history-item-problem">Mesin: ${item.input.machine_name || 'N/A'} - Masalah: ${item.input.problem_type || 'N/A'}</span>
                <span class="history-item-details">Deskripsi: ${item.input.problem_description.substring(0, 100)}${item.input.problem_description.length > 100 ? '...' : ''}</span>
            `;
            
            // Add click listener to load history item
            li.addEventListener('click', () => {
                console.log("Clicked history item:", item);
                
                // Show confirmation dialog
                if (confirm(`Lihat detail laporan ${item.input.machine_name} - ${item.input.problem_type}?`)) {
                    // Load the history item
                    fillFormWithHistory(item.input);
                    displayCapaResult(item.output, item.input);
                    
                    // Show the result and scroll to it
                    capaResultDiv.style.display = 'block';
                    capaResultDiv.scrollIntoView({ behavior: 'smooth' });
                    
                    // Hide history panel
                    historyContainer.style.display = 'none';
                    historyButton.textContent = 'Lihat Riwayat';
                }
            });
            
            historyList.appendChild(li);
        });
    }

    function clearHistory() {
        if (confirm("Apakah Anda yakin ingin menghapus semua riwayat laporan CAPA?")) {
            try {
                localStorage.removeItem(HISTORY_KEY);
                displayHistory(); // Refresh the displayed list (will show empty)
                console.log("History cleared.");
            } catch (e) {
                console.error("Error clearing history from localStorage:", e);
            }
        }
    }

    // --- Display CAPA Result (with Editable Fields) ---
    function displayCapaResult(aiResponse, inputData) {
        console.log("Displaying CAPA result with AI response:", aiResponse); // Debug log

        // Function to create styled textareas with content directly in the HTML
        const createTextarea = (id, content) => {
            console.log(`Creating textarea ${id} with content:`, content);

            // Use direct HTML with content as both value attribute and inner text
            // This ensures the content appears in the textarea
            return `<textarea
                id="${id}"
                style="width: 100%; min-height: 60px; margin-top: 5px; margin-bottom: 10px;
                border: 1px solid #ccc; border-radius: 4px; padding: 8px;
                font-family: inherit; font-size: inherit; box-sizing: border-box;"
            >${content || ''}</textarea>`;
        };

        const reportHTML = `
            <h3>CAPA Report</h3>
            <p><strong>Judul CAPA:</strong> Issue on ${inputData.machine_name} - ${inputData.event_date}</p>
            <p><strong>Nama Operator:</strong> ${inputData.operator_name}</p>
            <p><strong>Tanggal Kejadian:</strong> ${inputData.event_date}</p>
            <p><strong>Nama Mesin:</strong> ${inputData.machine_name}</p>
            <p><strong>Lokasi:</strong> ${inputData.location}</p>
            <p><strong>Jenis Masalah:</strong> ${inputData.problem_type}</p>

            <h3>Deskripsi Masalah</h3>
            <p>${inputData.problem_description}</p>

            <h3>Tindakan Awal</h3>
            <p>${inputData.initial_action}</p>

            <h3>Analisis Akar Masalah (AI Generated - Editable)</h3>
            ${createTextarea('editable-root-cause', aiResponse.rootCauseAnalysis)}

            <h3>Rekomendasi Tindakan Korektif (AI Generated - Editable)</h3>
             ${createTextarea('editable-corrective-actions', aiResponse.correctiveActions)}

            <h3>Rekomendasi Tindakan Preventif (AI Generated - Editable)</h3>
            ${createTextarea('editable-preventive-actions', aiResponse.preventiveActions)}

            <p><strong>PIC (AI Generated - Editable):</strong></p>
            ${createTextarea('editable-pic', aiResponse.pic)}

            <p><strong>Deadline (AI Generated - Editable):</strong></p>
             ${createTextarea('editable-deadline', aiResponse.deadline)}

            <h3>Bukti Foto</h3>
            ${uploadedImageBase64 ? `<img src="${uploadedImageBase64}" alt="Foto Cacat - ${inputData.defect_photo_filename}" style="max-width: 400px; margin-top: 10px;">` : '<p>Tidak ada foto diupload.</p>'}
        `;
        reportContentDiv.innerHTML = reportHTML;

        // Enable auto-resize for textareas after they are added to the DOM
        setTimeout(() => {
            const textareas = reportContentDiv.querySelectorAll('textarea');
            console.log(`Found ${textareas.length} textareas to resize`);
            textareas.forEach(textarea => {
                console.log(`Textarea ${textarea.id} content:`, textarea.value);
                // Add input event for auto-resize
                textarea.addEventListener('input', function() {
                    this.style.height = 'auto';
                    this.style.height = (this.scrollHeight) + 'px';
                });
                // Trigger initial resize
                textarea.style.height = 'auto';
                textarea.style.height = (textarea.scrollHeight) + 'px';
            });
        }, 200); // Increased delay to ensure DOM is fully rendered
    }

    // --- PDF Generation ---
    downloadPdfButton.addEventListener('click', () => {
        const { jsPDF } = window.jspdf;
        const reportElement = document.getElementById('report-content');

        // Method to get text content from textareas and other fields
        const getTextContent = () => {
            // Helper function to find element by text content (more robust)
            const findElementByText = (tag, text) => {
                const elements = reportElement.querySelectorAll(tag);
                for (let i = 0; i < elements.length; i++) {
                    // Check if the element's *direct* text content includes the search text
                    // This avoids matching nested elements unintentionally
                    if (elements[i].childNodes.length > 0 && elements[i].childNodes[0].nodeType === Node.TEXT_NODE && elements[i].childNodes[0].nodeValue.includes(text)) {
                         return elements[i];
                    }
                    // Fallback for simple <p><strong>Label:</strong> Value</p> structure
                    if (elements[i].querySelector('strong') && elements[i].querySelector('strong').textContent.includes(text)) {
                        return elements[i];
                    }
                }
                return null;
            };

            // Get all text field values
            const operatorNameElem = findElementByText('p', 'Nama Operator:');
            const eventDateElem = findElementByText('p', 'Tanggal Kejadian:');
            const machineNameElem = findElementByText('p', 'Nama Mesin:');
            const locationElem = findElementByText('p', 'Lokasi:');
            const problemTypeElem = findElementByText('p', 'Jenis Masalah:');

            // Extract text safely, handling potential null elements
            const extractText = (elem, label) => elem ? elem.textContent.replace(label, '').trim() : 'N/A';

            const operatorName = extractText(operatorNameElem, 'Nama Operator:');
            const eventDate = extractText(eventDateElem, 'Tanggal Kejadian:');
            const machineName = extractText(machineNameElem, 'Nama Mesin:');
            const location = extractText(locationElem, 'Lokasi:');
            const problemType = extractText(problemTypeElem, 'Jenis Masalah:');

            // Get description and initial action (assuming they follow their H3 tags)
            const descriptionElem = findElementByText('h3', 'Deskripsi Masalah');
            const initialActionElem = findElementByText('h3', 'Tindakan Awal');

            const problemDescription = descriptionElem && descriptionElem.nextElementSibling && descriptionElem.nextElementSibling.tagName === 'P' ?
                descriptionElem.nextElementSibling.textContent : 'N/A';
            const initialAction = initialActionElem && initialActionElem.nextElementSibling && initialActionElem.nextElementSibling.tagName === 'P' ?
                initialActionElem.nextElementSibling.textContent : 'N/A';

            // Get textarea values directly by ID (this is more reliable)
            const getTextAreaValue = (id) => document.getElementById(id) ? document.getElementById(id).value : 'N/A';

            const rootCauseAnalysis = getTextAreaValue('editable-root-cause');
            const correctiveActions = getTextAreaValue('editable-corrective-actions');
            const preventiveActions = getTextAreaValue('editable-preventive-actions');
            const pic = getTextAreaValue('editable-pic');
            const deadline = getTextAreaValue('editable-deadline');

            // Log content for debugging
            console.log({
                operatorName, eventDate, machineName, location, problemType,
                problemDescription, initialAction, rootCauseAnalysis,
                correctiveActions, preventiveActions, pic, deadline
            });

            return {
                operatorName, eventDate, machineName, location, problemType,
                problemDescription, initialAction, rootCauseAnalysis,
                correctiveActions, preventiveActions, pic, deadline
            };
        };

        try {
            // Create a new PDF document
            const pdf = new jsPDF({
                orientation: 'p',
                unit: 'mm',
                format: 'a4'
            });

            // Get content from the form (including edited textarea values)
            const textContent = getTextContent();
            console.log("PDF Content:", textContent);

            // Define premium color palette
            const brandPrimary = [0, 86, 179]; // #0056b3 (brand blue)
            const brandSecondary = [33, 150, 243]; // #2196f3 (lighter blue)
            const accentColor = [255, 152, 0]; // #ff9800 (orange)
            const darkColor = [40, 40, 40]; // #282828
            const lightGray = [245, 245, 245]; // #f5f5f5
            const white = [255, 255, 255]; // #ffffff

            // Document Info for metadata
            pdf.setProperties({
                title: `CAPA Report - ${textContent.machineName}`,
                subject: `Problem report for ${textContent.problemType}`,
                author: 'CAPA AI Generator',
                keywords: 'CAPA, quality, report',
                creator: 'CAPA AI Generator'
            });

            // --- Cover Page ---
            // Background gradient effect (simulate with multiple rectangles)
            for (let i = 0; i < 20; i++) {
                const alpha = 0.5 - (i * 0.025);
                pdf.setFillColor(...brandPrimary, alpha);
                pdf.rect(0, i * 14, 210, 14, 'F');
            }

            // White overlay for content area
            pdf.setFillColor(...white);
            pdf.roundedRect(20, 40, 170, 220, 5, 5, 'F');

            // Document type badge
            pdf.setFillColor(...accentColor);
            pdf.roundedRect(20, 40, 170, 15, 3, 3, 'F');
            pdf.setFont("helvetica", "bold");
            pdf.setTextColor(...white);
            pdf.setFontSize(10);
            pdf.text("CORRECTIVE AND PREVENTIVE ACTION REPORT", 105, 49, { align: "center" });

            // Report title
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(24);
            pdf.setTextColor(...darkColor);
            pdf.text(`${textContent.machineName}`, 105, 80, { align: "center" });
            pdf.setFontSize(18);
            pdf.text(`${textContent.problemType} Issue`, 105, 90, { align: "center" });

            // Horizontal rule
            pdf.setDrawColor(...brandPrimary);
            pdf.setLineWidth(1);
            pdf.line(40, 95, 170, 95);

            // Add professional icon/logo (simulated with shapes)
            pdf.setFillColor(...brandPrimary);
            pdf.circle(105, 120, 15, 'F');
            pdf.setFillColor(...white);
            // Simulate document icon inside circle
            pdf.rect(100, 115, 10, 10, 'F');
            pdf.setDrawColor(...brandPrimary);
            pdf.setLineWidth(0.5);
            pdf.line(102, 118, 108, 118);
            pdf.line(102, 121, 108, 121);
            pdf.line(102, 124, 108, 124);

            // Cover page info
            pdf.setFontSize(12);
            pdf.setTextColor(...darkColor);
            pdf.setFont("helvetica", "normal");

            // Two-column layout for basic info
            const coverInfoY = 150;

            // Info box with subtle background
            pdf.setFillColor(...lightGray);
            pdf.roundedRect(40, coverInfoY, 130, 60, 3, 3, 'F');

            // Left column labels
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(10);
            pdf.text("Prepared by:", 50, coverInfoY + 10);
            pdf.text("Date of Event:", 50, coverInfoY + 22);
            pdf.text("Location:", 50, coverInfoY + 34);
            pdf.text("Investigation Date:", 50, coverInfoY + 46);

            // Right column values
            pdf.setFont("helvetica", "normal");
            pdf.text(textContent.operatorName, 120, coverInfoY + 10);
            pdf.text(textContent.eventDate, 120, coverInfoY + 22);
            pdf.text(textContent.location, 120, coverInfoY + 34);
            pdf.text(new Date().toLocaleDateString('id-ID'), 120, coverInfoY + 46);

            // Footer
            pdf.setFontSize(8);
            pdf.setTextColor(...darkColor);
            pdf.text("CONFIDENTIAL - FOR INTERNAL USE ONLY", 105, 250, { align: "center" });
            pdf.setFontSize(7);
            pdf.text(`Generated on ${new Date().toLocaleString('id-ID')}`, 105, 255, { align: "center" });

            // Page border
            pdf.setDrawColor(...brandPrimary);
            pdf.setLineWidth(0.5);
            pdf.rect(10, 10, 190, 277);

            // Accent corner graphics
            pdf.setFillColor(...accentColor);
            pdf.triangle(10, 10, 30, 10, 10, 30, 'F');
            pdf.triangle(200, 10, 200, 30, 180, 10, 'F');
            pdf.triangle(10, 287, 30, 287, 10, 267, 'F');
            pdf.triangle(200, 287, 200, 267, 180, 287, 'F');

            // Add Executive Summary Page
            pdf.addPage();

            // Helper functions for consistent styling
            const addPageHeader = (pageTitle) => {
                // Header bar
                pdf.setFillColor(...brandPrimary);
                pdf.rect(0, 0, 210, 20, 'F');

                // Header title
                pdf.setTextColor(...white);
                pdf.setFontSize(14);
                pdf.setFont("helvetica", "bold");
                pdf.text(pageTitle, 105, 13, { align: "center" });

                // Document title in smaller text
                pdf.setFontSize(8);
                pdf.setFont("helvetica", "normal");
                pdf.text(`${textContent.machineName} - ${textContent.problemType}`, 190, 13, { align: "right" });

                // Accent bar
                pdf.setFillColor(...accentColor);
                pdf.rect(0, 20, 210, 2, 'F');
            };

            const addPageFooter = (pageNumber) => {
                // Footer bar
                pdf.setFillColor(...lightGray);
                pdf.rect(0, 277, 210, 20, 'F');

                // Page number
                pdf.setTextColor(...darkColor);
                pdf.setFontSize(8);
                pdf.text(`Page ${pageNumber} | CAPA Report`, 15, 289);

                // Confidentiality note
                pdf.setFont("helvetica", "italic");
                pdf.text("Confidential", 190, 289, { align: "right" });

                // Accent line
                pdf.setFillColor(...accentColor);
                pdf.rect(0, 277, 210, 0.5, 'F');
            };

            const addSectionTitle = (title, yPos) => {
                // Section title with accent styling
                pdf.setFillColor(...brandPrimary);
                pdf.roundedRect(10, yPos - 5, 190, 10, 2, 2, 'F');
                pdf.setTextColor(...white);
                pdf.setFontSize(11);
                pdf.setFont("helvetica", "bold");
                pdf.text(title, 15, yPos + 1);

                return yPos + 15;
            };

            const addContentBox = (content, yPos, title = null) => {
                // Calculate height needed based on content length
                const contentLines = pdf.splitTextToSize(content, 170); // Width available for text
                const boxHeight = contentLines.length * 5.5 + (title ? 20 : 15); // Adjust height based on title presence

                // Content box with subtle shadow effect
                pdf.setFillColor(...lightGray);
                pdf.roundedRect(14, yPos, 182, boxHeight, 2, 2, 'F'); // Outer box for shadow
                pdf.setFillColor(...white);
                pdf.roundedRect(12, yPos - 2, 182, boxHeight, 2, 2, 'F'); // Inner white box

                let textY = yPos + 8; // Starting Y for text

                // Optional subtitle
                if (title) {
                    pdf.setTextColor(...brandPrimary);
                    pdf.setFontSize(10);
                    pdf.setFont("helvetica", "bold");
                    pdf.text(title, 20, textY);
                    pdf.setDrawColor(...brandPrimary);
                    pdf.line(20, textY + 2, 50, textY + 2); // Underline for title
                    textY += 10; // Add space after title
                }

                // Content text
                pdf.setTextColor(...darkColor);
                pdf.setFontSize(10);
                pdf.setFont("helvetica", "normal");
                pdf.text(contentLines, 20, textY); // Add text inside the box

                return yPos + boxHeight + 10; // Return next Y position
            };


            // Executive Summary Page
            addPageHeader("EXECUTIVE SUMMARY");
            let y = 35;

            // Problem summary box
            y = addSectionTitle("PROBLEM OVERVIEW", y);

            // Create a problem summary by combining info
            const problemSummary = `The ${textContent.problemType} issue was reported by ${textContent.operatorName} on ${textContent.eventDate} at the ${textContent.location} facility involving the ${textContent.machineName}. ${textContent.problemDescription}`;

            y = addContentBox(problemSummary, y);

            // Initial response
            y = addSectionTitle("INITIAL RESPONSE", y);
            y = addContentBox(textContent.initialAction, y);

            // Root cause findings
            y = addSectionTitle("ROOT CAUSE ANALYSIS", y);
            y = addContentBox(textContent.rootCauseAnalysis, y);

            // Action plan overview with graphics
            y = addSectionTitle("ACTION PLAN OVERVIEW", y);

            // Add horizontal timeline-like graphic
            const timelineY = y + 10;

            // Timeline line
            pdf.setDrawColor(...brandSecondary);
            pdf.setLineWidth(1);
            pdf.line(30, timelineY, 180, timelineY);

            // Timeline nodes
            pdf.setFillColor(...accentColor);
            pdf.circle(40, timelineY, 4, 'F');
            pdf.circle(105, timelineY, 4, 'F');
            pdf.circle(170, timelineY, 4, 'F');

            // Timeline labels
            pdf.setTextColor(...darkColor);
            pdf.setFontSize(8);
            pdf.setFont("helvetica", "bold");
            pdf.text("INVESTIGATION", 40, timelineY - 8, { align: "center" });
            pdf.text("CORRECTIVE ACTIONS", 105, timelineY - 8, { align: "center" });
            pdf.text("PREVENTIVE MEASURES", 170, timelineY - 8, { align: "center" });

            // Timeline dates
            pdf.setFontSize(7);
            pdf.setFont("helvetica", "italic");
            const today = new Date();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const nextWeek = new Date(today);
            nextWeek.setDate(nextWeek.getDate() + 7);

            pdf.text(today.toLocaleDateString('id-ID'), 40, timelineY + 8, { align: "center" });
            pdf.text(tomorrow.toLocaleDateString('id-ID'), 105, timelineY + 8, { align: "center" });
            pdf.text(nextWeek.toLocaleDateString('id-ID'), 170, timelineY + 8, { align: "center" });

            y = timelineY + 20;

            // Add page footer
            addPageFooter(1);

            // Detailed Analysis Page
            pdf.addPage();
            addPageHeader("CORRECTIVE & PREVENTIVE ACTIONS");
            y = 35;

            // Corrective Actions
            y = addSectionTitle("CORRECTIVE ACTIONS", y);
            y = addContentBox(textContent.correctiveActions, y);

            // Preventive Actions
            y = addSectionTitle("PREVENTIVE ACTIONS", y);
            y = addContentBox(textContent.preventiveActions, y);

            // Responsibility and Schedule
            y = addSectionTitle("RESPONSIBILITY & TIMELINE", y);

            // Create a table-like structure with grid
            pdf.setFillColor(...lightGray);
            pdf.roundedRect(14, y, 182, 50, 2, 2, 'F');
            pdf.setFillColor(...white);
            pdf.roundedRect(12, y - 2, 182, 50, 2, 2, 'F');

            // Table header
            pdf.setFillColor(...brandPrimary);
            pdf.rect(20, y + 5, 75, 8, 'F');
            pdf.rect(105, y + 5, 75, 8, 'F');

            pdf.setTextColor(...white);
            pdf.setFontSize(9);
            pdf.setFont("helvetica", "bold");
            pdf.text("PERSON IN CHARGE", 57.5, y + 10, { align: "center" });
            pdf.text("DEADLINE", 142.5, y + 10, { align: "center" });

            // Table content
            pdf.setTextColor(...darkColor);
            pdf.setFontSize(10);
            pdf.setFont("helvetica", "normal");
            pdf.text(textContent.pic, 57.5, y + 25, { align: "center" });
            pdf.text(textContent.deadline, 142.5, y + 25, { align: "center" });

            y += 60;

            // Evidence section with photo
            if (uploadedImageBase64) {
                y = addSectionTitle("EVIDENCE", y);

                // Photo frame with shadow effect
                pdf.setFillColor(...lightGray);
                pdf.roundedRect(34, y, 142, 95, 2, 2, 'F');
                pdf.setFillColor(...white);
                pdf.roundedRect(32, y - 2, 142, 95, 2, 2, 'F');

                // Photo caption
                pdf.setTextColor(...brandPrimary);
                pdf.setFontSize(9);
                pdf.setFont("helvetica", "bold");
                pdf.text(`Documentation of ${textContent.problemType} issue on ${textContent.machineName}`, 105, y + 8, { align: "center" });

                try {
                    // Calculate image dimensions to fit within frame
                    const imgWidth = 130;
                    const imgHeight = 75;

                    // Add image
                    pdf.addImage(uploadedImageBase64, 'JPEG', 38, y + 15, imgWidth, imgHeight);
                } catch (imgError) {
                    console.error("Error adding image to PDF:", imgError);
                    pdf.setFont("helvetica", "normal");
                    pdf.text("Image could not be loaded", 105, y + 50, { align: "center" });
                }
                 y += 105; // Adjust y position after adding image box
            }

            // Add page footer
            addPageFooter(2);

            // Add Approval Page
            pdf.addPage();
            addPageHeader("APPROVAL & SIGN-OFF");
            y = 35;

            // Brief summary
            pdf.setTextColor(...darkColor);
            pdf.setFontSize(10);
            pdf.setFont("helvetica", "normal");
            pdf.text("This CAPA report has been prepared in accordance with quality management requirements. The", 105, y, { align: "center" });
            pdf.text("corrective and preventive actions detailed in this report require implementation approval.", 105, y + 7, { align: "center" });

            y += 25;

            // Approval boxes
            const createSignatureBox = (title, role, yPos) => {
                // Box with shadow effect
                pdf.setFillColor(...lightGray);
                pdf.roundedRect(52, yPos, 106, 50, 2, 2, 'F');
                pdf.setFillColor(...white);
                pdf.roundedRect(50, yPos - 2, 106, 50, 2, 2, 'F');

                // Title
                pdf.setTextColor(...brandPrimary);
                pdf.setFontSize(10);
                pdf.setFont("helvetica", "bold");
                pdf.text(title, 103, yPos + 8, { align: "center" });

                // Role
                pdf.setTextColor(...darkColor);
                pdf.setFontSize(9);
                pdf.setFont("helvetica", "italic");
                pdf.text(role, 103, yPos + 18, { align: "center" });

                // Signature line
                pdf.setDrawColor(...darkColor);
                pdf.line(65, yPos + 35, 140, yPos + 35);

                // Date
                pdf.setFontSize(8);
                pdf.text("Date: ____________________", 103, yPos + 45, { align: "center" });

                return yPos + 60;
            };

            // Create signature boxes
            y = createSignatureBox("Prepared by:", "Quality Control Specialist", y);
            y = createSignatureBox("Reviewed by:", "Department Manager", y);
            y = createSignatureBox("Approved by:", "Quality Assurance Director", y);

            // Add page footer
            addPageFooter(3);

            // Save the PDF
            pdf.save(`CAPA_Report_${textContent.machineName}_${Date.now()}.pdf`);

        } catch (error) {
            console.error("Error generating PDF:", error);
            alert("Gagal membuat PDF. Silakan cek konsol untuk detail.");
        }
    });

}); // End DOMContentLoaded
