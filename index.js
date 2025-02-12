require('dotenv').config()

const express = require('express')
const cors = require('cors')
const multer = require('multer')
const fs = require('fs')
const { join } = require('path')
const OpenAI = require('openai')
const mime = require('mime-types')
const { SpeechClient } = require('@google-cloud/speech')
const { Translate } = require('@google-cloud/translate').v2

const app = express()
const port = process.env.PORT || 5000

app.use(cors())
app.use(express.json())

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' })

const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_API_KEY
})

// Initialize Google Cloud clients
const speechClient = new SpeechClient()
const translateClient = new Translate()

app.post('/speech-to-text', upload.single('file'), async (req, res) => {
  try {
    const file = req.file

    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' })
    }

    // Construct the full path to the uploaded file with the correct extension
    const originalPath = join(process.cwd(), 'uploads', file.filename)
    const newPath = `${originalPath}.webm`

    // Rename the file to include the extension
    fs.renameSync(originalPath, newPath)

    // Process the file with OpenAI API
    const [transcription, translation] = await Promise.all([
      openai.audio.transcriptions.create({
        file: fs.createReadStream(newPath),
        model: 'whisper-1',
        response_format: 'text'
      }),
      openai.audio.translations.create({
        file: fs.createReadStream(newPath),
        model: 'whisper-1',
        response_format: 'text'
      })
    ])

    // Clean up the uploaded file
    fs.unlinkSync(newPath)

    return res.status(200).json({ transcription, translation })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ message: 'Error processing audio' })
  }
})

app.post('/google-speech-to-text', upload.single('file'), async (req, res) => {
  try {
    const file = req.file

    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' })
    }

    // Construct the full path to the uploaded file
    const filePath = join(process.cwd(), 'uploads', file.filename)

    // Read the file into a buffer
    const audioBytes = fs.readFileSync(filePath).toString('base64')

    // Configure request for Google Speech-to-Text
    const audio = { content: audioBytes }
    const config = { languageCode: 'en-US' }
    const request = { audio, config }

    // Detect speech in the audio file
    const [response] = await speechClient.recognize(request)
    console.log(response)
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n')

    // Translate the transcription
    const [translation] = await translateClient.translate(transcription, 'es') // Translate to Spanish

    // Clean up the uploaded file
    fs.unlinkSync(filePath)

    return res.status(200).json({ transcription, translation })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ message: 'Error processing audio' })
  }
})

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`)
})
