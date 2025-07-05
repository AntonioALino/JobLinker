// Em: apps/api/src/index.ts
import express from 'express';
import dotenv from 'dotenv';
import multer from 'multer';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios'; 

dotenv.config();

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const app = express();
const port = process.env.PORT || 3001;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

app.use(express.json());

app.post('/api/analyze', upload.single('cv'), async (req, res) : Promise<any> => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum currículo enviado.' });
        }
        let cvText = '';
        if (req.file.mimetype === 'application/pdf') {
            const data = await pdf(req.file.buffer);
            cvText = data.text;
        } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const { value } = await mammoth.extractRawText({ buffer: req.file.buffer });
            cvText = value;
        } else {
            return res.status(400).json({ error: 'Formato de arquivo não suportado.' });
        }
        const { jobDescription, jobUrl } = req.body;
        let finalJobDescription = '';

        if (jobUrl && jobUrl.trim() !== '') {
            try {
                const pageResponse = await axios.get(jobUrl, {
                    headers: { 
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });
                const htmlContent = pageResponse.data;

                const extractionPrompt = `
                    Analise o seguinte conteúdo HTML de uma página de vaga de emprego. Sua única tarefa é extrair e retornar APENAS o texto principal da descrição da vaga. 
                    Ignore completamente cabeçalhos, rodapés, menus de navegação, barras laterais, anúncios, scripts e qualquer outro conteúdo irrelevante.
                    Retorne apenas o texto limpo da descrição.

                    HTML: """
                    ${htmlContent}
                    """
                `;
                const extractionResult = await model.generateContent(extractionPrompt);
                finalJobDescription = extractionResult.response.text();

            } catch (scrapeError) {
                console.error("Erro durante o scraping da URL:", scrapeError);
                return res.status(500).json({ error: 'Falha ao buscar ou processar o conteúdo da URL fornecida.' });
            }
        } else if (jobDescription && jobDescription.trim() !== '') {
            finalJobDescription = jobDescription;
        } else {
            return res.status(400).json({ error: 'Forneça a descrição da vaga ou um link válido.' });
        }
        
        const analysisPrompt = `
            Aja como um especialista em recrutamento técnico. Analise o currículo (CV) e a descrição da vaga a seguir.
            Com base na compatibilidade de habilidades, tecnologias, experiências e palavras-chave, forneça uma análise estruturada em formato JSON.

            O JSON de saída DEVE ter a seguinte estrutura e nada mais, sem blocos de código markdown (sem \`\`\`):
            {
              "compatibilityPercentage": <um número de 0 a 100>,
              "summary": "<um parágrafo curto explicando o porquê da porcentagem>",
              "matchingKeywords": ["<lista de palavras-chave encontradas em ambos>"],
              "missingKeywords": ["<lista de palavras-chave importantes da vaga que faltam no currículo>"]
            }

            CV: """
            ${cvText}
            """

            Descrição da Vaga: """
            ${finalJobDescription} 
            """
        `;

        const result = await model.generateContent(analysisPrompt);
        const responseText = result.response.text();
        
        const startIndex = responseText.indexOf('{');
        const endIndex = responseText.lastIndexOf('}');

        if (startIndex === -1 || endIndex === -1) {
            console.error("[ERRO CRÍTICO] A resposta da IA não continha um objeto JSON. A resposta foi:", responseText);
            throw new Error('A resposta da IA não continha um objeto JSON válido.');
        }

        const jsonString = responseText.slice(startIndex, endIndex + 1);
        const analysisResult = JSON.parse(jsonString);

        res.json(analysisResult);

    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            error: 'Falha ao analisar o currículo.',
            details: error instanceof Error ? error.message : 'Erro desconhecido'
        });
    }
});

app.listen(port, () => {
    console.log(`[server]: API running at http://localhost:${port}`);
});
