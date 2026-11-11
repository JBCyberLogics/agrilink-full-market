import { AI_CAPABILITIES } from '../config.js'
import { requestAI } from '../client.js'

export const produceFinder = (payload) => requestAI(AI_CAPABILITIES.PRODUCE_FINDER, payload)
export const supplierAdvisor = (payload) => requestAI(AI_CAPABILITIES.SUPPLIER_ADVISOR, payload)
export const purchaseAssistant = (payload) => requestAI(AI_CAPABILITIES.PURCHASE_ASSISTANT, payload)
