require('dotenv').config()
const express = require('express')
const cors = require('cors')
const multer = require('multer')
const fs = require('fs').promises
const path = require('path')
const OpenAI = require('openai')
const { SpeechClient } = require('@google-cloud/speech')
const { Translate } = require('@google-cloud/translate').v2

// Configuration
const config = require('./config')
// Initialize clients
const app = express()

const speechClient = new SpeechClient()
const translateClient = new Translate()

// Middleware
app.use(cors())
app.use(express.json())

// Configure multer
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(config.uploadDir, { recursive: true })
      cb(null, config.uploadDir)
    } catch (error) {
      cb(error)
    }
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname)
    cb(null, `${Date.now()}${extension}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: config.maxFileSize },
  fileFilter: (req, file, cb) => {
    if (config.supportedMimeTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Unsupported file type'))
    }
  }
})

// Helper functions
const detectLanguage = async text => {
  try {
    const [detection] = await translateClient.detect(text)
    console.log('Language detection:', detection)
    return detection.language
  } catch (error) {
    console.error('Language detection error:', error)
    return 'en' // Default to English
  }
}

const translateText = async (text, targetLanguage) => {
  try {
    const sourceLanguage = await detectLanguage(text)
    if (sourceLanguage === targetLanguage) {
      return text
    }
    const [translation] = await translateClient.translate(text, targetLanguage)
    return translation
  } catch (error) {
    throw new Error(`Translation error: ${error.message}`)
  }
}

app.post('/google-speech-to-text', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' })
    }

    const targetLanguage = req.body.targetLanguage || 'en'

    // Convert ISO language code to BCP-47 language code
    const getBCP47LanguageCode = languageCode => {
      const languageMap = {
        en: 'en-US',
        es: 'es-ES',
        ar: 'ar-SA',
        hi: 'hi-IN',
        bn: 'bn-BD',
        id: 'id-ID',
        fil: 'fil-PH',
        ja: 'ja-JP'
      }
      return languageMap[languageCode] || languageCode
    }

    const bcp47LanguageCode = getBCP47LanguageCode(targetLanguage)

    if (!config.supportedLanguages.includes(targetLanguage)) {
      return res.status(400).json({ error: 'Unsupported target language' })
    }

    // Read audio file
    const audioBytes = await fs.readFile(req.file.path)
    const audio = { content: audioBytes.toString('base64') }

    // Simplified and corrected speech recognition config
    const speechConfig = {
      languageCode: bcp47LanguageCode,
      alternativeLanguageCodes: config.supportedLanguages.filter(
        lang => lang !== targetLanguage
      ),
      enableAutomaticPunctuation: true,
      model: 'latest_long',
      metadata: {
        interactionType: 'DICTATION',
        microphoneDistance: 'NEARFIELD',
        recordingDeviceType: 'SMARTPHONE'
      }
    }

    // Perform speech recognition
    const [response] = await speechClient.recognize({
      audio,
      config: speechConfig
    })

    // Handle no results
    if (!response.results || response.results.length === 0) {
      throw new Error('No speech could be recognized')
    }

    // Get transcription
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join(' ')

    // Detect language and translate
    const detectedLanguage = await detectLanguage(transcription)
    const translation = await translateText(transcription, targetLanguage)

    // Clean up
    await fs.unlink(req.file.path)

    res.json({
      success: true,
      sourceLanguage: detectedLanguage,
      targetLanguage,
      transcription,
      translation,
      details: {
        usedConfig: {
          primaryLanguage: targetLanguage,
          alternativeLanguages: speechConfig.alternativeLanguageCodes
        }
      }
    })
  } catch (error) {
    console.error('Google Speech API error:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      details: error.details || undefined
    })
  }
})

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    supportedLanguages: config.supportedLanguages,
    supportedMimeTypes: config.supportedMimeTypes
  })
})

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Global error handler:', error)
  res.status(500).json({
    success: false,
    error: error.message || 'Internal server error'
  })
})

// Start server
app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`)
})
