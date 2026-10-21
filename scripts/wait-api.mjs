import net from 'node:net'

const port = Number(process.env.PORT || 8787)
const host = '127.0.0.1'
const deadline = Date.now() + 30_000

await new Promise((resolve, reject) => {
  const tryOnce = () => {
    const socket = net.connect({ port, host }, () => {
      socket.end()
      resolve(undefined)
    })
    socket.on('error', () => {
      socket.destroy()
      if (Date.now() > deadline) {
        reject(new Error(`Anjz API did not start on ${host}:${port}`))
        return
      }
      setTimeout(tryOnce, 250)
    })
  }
  tryOnce()
})
