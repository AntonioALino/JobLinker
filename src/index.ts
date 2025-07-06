import express from 'express';
import dotenv from 'dotenv';
import multer from 'multer';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import cors from 'cors'

dotenv.config();



const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const app = express();
const port = process.env.PORT || 3001;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });


app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST'], 
    allowedHeaders: ['Content-Type', 'Authorization'] 
}));
app.use(express.json());

app.post('/api/analyze', upload.single('cv'), async (req, res) : Promise<any>=> {
    console.log('\n--- [NOVA REQUISIÇÃO INTELIGENTE] ---');
    try {
        if (!req.file) return res.status(400).json({ error: 'Nenhum currículo enviado.' });
        
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
            const pageResponse = await axios.get(jobUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const htmlContent = pageResponse.data;
            const extractionPrompt = `Extraia apenas o texto principal da descrição da vaga do seguinte HTML, ignorando todo o resto: """${htmlContent}"""`;
            const extractionResult = await model.generateContent(extractionPrompt);
            finalJobDescription = extractionResult.response.text();
        } else if (jobDescription && jobDescription.trim() !== '') {
            finalJobDescription = jobDescription;
        } else {
            return res.status(400).json({ error: 'Forneça a descrição da vaga ou um link válido.' });
        }

        const analysisPrompt = `
            Aja como um recrutador. Analise o CV e a Vaga. Retorne APENAS um objeto JSON com a seguinte estrutura:
            {
              "compatibilityPercentage": <number>,
              "summary": "<string>",
              "matchingKeywords": ["<string>"],
              "missingKeywords": ["<string>"]
            }
            CV: """${cvText}"""
            Vaga: """${finalJobDescription}"""
        `;
        const initialResult = await model.generateContent(analysisPrompt);
        const initialResponseText = initialResult.response.text();
        const jsonString = initialResponseText.slice(initialResponseText.indexOf('{'), initialResponseText.lastIndexOf('}') + 1);
        let analysisResult = JSON.parse(jsonString);

        console.log(`[DEBUG] Score inicial: ${analysisResult.compatibilityPercentage}%`);

        const score = analysisResult.compatibilityPercentage;
        let secondaryPrompt = '';

        if (score > 70) {
            console.log('[DEBUG] Score alto. Gerando Kit de Entrevista...');
            secondaryPrompt = `
                Com base no CV e na Vaga a seguir, gere um "Kit de Preparação para Entrevista".
                Retorne APENAS um objeto JSON com a estrutura:
                {
                  "technicalQuestions": [{ "question": "<string>", "answerTip": "<string>" }],
                  "behavioralQuestions": [{ "question": "<string>", "answerTip": "<string>" }],
                  "companyDossier": { "summary": "<string>", "talkingPoints": ["<string>"] }
                }
                CV: """${cvText}"""
                Vaga: """${finalJobDescription}"""
            `;
            const interviewKitResult = await model.generateContent(secondaryPrompt);
            const interviewKitText = interviewKitResult.response.text();
            const kitJsonString = interviewKitText.slice(interviewKitText.indexOf('{'), interviewKitText.lastIndexOf('}') + 1);
            analysisResult.interviewKit = JSON.parse(kitJsonString);

        } else if (score <= 70) {
            console.log('[DEBUG] Score baixo. Gerando Plano de Desenvolvimento...');
            secondaryPrompt = `
                Com base no CV e na Vaga a seguir, que têm baixa compatibilidade, crie um "Plano de Desenvolvimento de Carreira".
                Retorne APENAS um objeto JSON com a estrutura:
                {
                  "skillsGapAnalysis": [{ "skill": "<string>", "context": "<string>" }],
                  "actionPlan": { "courses": ["<string>"], "projectIdeas": ["<string>"] },
                  "alternativeCareerPath": { "suggestion": "<string>", "reason": "<string>" }
                }
                CV: """${cvText}"""
                Vaga: """${finalJobDescription}"""
            `;
            const devPlanResult = await model.generateContent(secondaryPrompt);
            const devPlanText = devPlanResult.response.text();
            const planJsonString = devPlanText.slice(devPlanText.indexOf('{'), devPlanText.lastIndexOf('}') + 1);
            analysisResult.developmentPlan = JSON.parse(planJsonString);
        }

        console.log('[DEBUG] Enviando resposta final para o cliente.');
        res.json(analysisResult);

    } catch (error) {
        console.error("Erro no processamento da análise inteligente:", error);
        res.status(500).json({ 
            error: 'Ocorreu um erro no servidor durante a análise.',
            details: error instanceof Error ? error.message : 'Erro desconhecido'
        });
    }
});

app.listen(port, () => {
    console.log(`[server]: API running at http://localhost:${port}`);
});
