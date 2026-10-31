/**
 * DYNAMO PAY — Android Device Diagnostics.
 *
 * Provides diagnostic endpoints for the Dynamo Bridge Android app
 * and Super Admin fleet manager to verify device health, permissions,
 * and connectivity.
 */
export class AndroidDiagnostics {
  /**
   * @param {{
   *   observerDeviceRepo: import('@youpi/db').MerchantObserverDeviceRepository,
   *   upiConnectionRepo: import('@youpi/db').MerchantUpiConnectionRepository,
   *   upiMirrorObservationRepo: import('@youpi/db').UpiMirrorObservationRepository,
   *   connectionHealthEventRepo: import('@youpi/db').ConnectionHealthEventRepository
   * }} options
   */
  constructor(options) {
    this.observerDeviceRepo = options.observerDeviceRepo;
    this.upiConnectionRepo = options.upiConnectionRepo;
    this.upiMirrorObservationRepo = options.upiMirrorObservationRepo;
    this.connectionHealthEventRepo = options.connectionHealthEventRepo;
  }

  /**
   * Run diagnostics for a specific device.
   */
  async runDeviceDiagnostics(deviceId) {
    const device = this.observerDeviceRepo.findById(deviceId);
    if (!device) {
      return { error: 'Device not found', statusCode: 404 };
    }

    const checks = [];

    // 1. Pairing state check
    checks.push({
      name: 'Pairing State',
      status: device.pairingState === 'PAIRED' ? 'PASS' : 'FAIL',
      detail: `Device pairing state: ${device.pairingState}`,
      remediation: device.pairingState !== 'PAIRED' ? 'Re-pair device via merchant dashboard QR' : null
    });

    // 2. Listener status check
    checks.push({
      name: 'Notification Listener',
      status: device.listenerStatus === 'ACTIVE' ? 'PASS' : 'WARN',
      detail: `Listener status: ${device.listenerStatus}`,
      remediation: device.listenerStatus !== 'ACTIVE' ? 'Grant notification access in Android settings' : null
    });

    // 3. Notification permission check
    checks.push({
      name: 'Notification Permission',
      status: device.notificationPermission ? 'PASS' : 'FAIL',
      detail: `Notification permission granted: ${device.notificationPermission}`,
      remediation: !device.notificationPermission ? 'Enable notification access for Dynamo Bridge' : null
    });

    // 4. Heartbeat freshness check
    const heartbeatAge = device.lastHeartbeatAt
      ? Date.now() - new Date(device.lastHeartbeatAt).getTime()
      : null;
    const heartbeatOk = heartbeatAge !== null && heartbeatAge < 300000; // 5 minutes
    checks.push({
      name: 'Heartbeat Freshness',
      status: heartbeatOk ? 'PASS' : heartbeatAge === null ? 'FAIL' : 'WARN',
      detail: heartbeatAge === null ? 'No heartbeat recorded'
        : heartbeatOk ? `Heartbeat ${Math.round(heartbeatAge / 1000)}s ago`
        : `Heartbeat ${Math.round(heartbeatAge / 1000)}s ago (stale)`,
      remediation: !heartbeatOk ? 'Restart Dynamo Bridge foreground service' : null
    });

    // 5. Event forwarding check
    const lastEventAge = device.lastEventAt
      ? Date.now() - new Date(device.lastEventAt).getTime()
      : null;
    checks.push({
      name: 'Event Forwarding',
      status: lastEventAge !== null && lastEventAge < 600000 ? 'PASS' : 'INFO',
      detail: lastEventAge === null ? 'No events forwarded yet'
        : `Last event ${Math.round(lastEventAge / 1000)}s ago`,
      remediation: null
    });

    // 6. Latency check
    checks.push({
      name: 'Forwarding Latency',
      status: device.avgForwardingLatencyMs !== null && device.avgForwardingLatencyMs < 1000 ? 'PASS' : 'WARN',
      detail: device.avgForwardingLatencyMs !== null
        ? `Avg latency: ${device.avgForwardingLatencyMs}ms`
        : 'No latency data',
      remediation: device.avgForwardingLatencyMs !== null && device.avgForwardingLatencyMs >= 1000
        ? 'Check network connectivity to backend' : null
    });

    // 7. UPI connection linkage check
    const connections = this.upiConnectionRepo.findByObserverDevice(deviceId);
    checks.push({
      name: 'UPI Connection Linkage',
      status: connections.length > 0 ? 'PASS' : 'INFO',
      detail: `Linked to ${connections.length} UPI connection(s)`,
      remediation: connections.length === 0 ? 'Link a UPI connection to this device' : null
    });

    // Overall status
    const failed = checks.filter(c => c.status === 'FAIL').length;
    const warnings = checks.filter(c => c.status === 'WARN').length;
    const overall = failed > 0 ? 'FAIL' : warnings > 0 ? 'WARN' : 'PASS';

    return {
      deviceId,
      deviceName: device.deviceName,
      merchantId: device.merchantId,
      overall,
      checks,
      lastHeartbeatAt: device.lastHeartbeatAt,
      lastEventAt: device.lastEventAt,
      avgForwardingLatencyMs: device.avgForwardingLatencyMs,
      linkedConnections: connections.map(c => ({
        id: c.id,
        vpa: c.vpa,
        connectionState: c.connectionState,
        healthStatus: c.healthStatus
      })),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Run diagnostics for all devices of a merchant.
   */
  async runMerchantDiagnostics(merchantId) {
    const devices = this.observerDeviceRepo.findByMerchant(merchantId);
    const results = [];
    for (const d of devices) {
      results.push(await this.runDeviceDiagnostics(d.id));
    }

    const total = results.length;
    const passing = results.filter(r => r.overall === 'PASS').length;
    const warning = results.filter(r => r.overall === 'WARN').length;
    const failing = results.filter(r => r.overall === 'FAIL').length;

    return {
      merchantId,
      totalDevices: total,
      passing,
      warning,
      failing,
      devices: results,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get connection health summary for a UPI connection.
   */
  async getConnectionHealth(upiConnectionId) {
    const events = this.connectionHealthEventRepo.findByConnection(upiConnectionId, 50);
    const observations = this.upiMirrorObservationRepo.findByConnection(upiConnectionId, 100);

    const recentEvents = events.filter(e =>
      Date.now() - new Date(e.createdAt).getTime() < 3600000 // last hour
    );

    const stateChanges = events.filter(e => e.previousState !== e.newState);
    const errors = events.filter(e => e.errorMessage);

    return {
      upiConnectionId,
      totalHealthEvents: events.length,
      recentEvents: recentEvents.length,
      stateChanges: stateChanges.length,
      errors: errors.length,
      lastEvent: events.length > 0 ? events[0] : null,
      observations: {
        total: observations.length,
        pending: observations.filter(o => o.classification === 'PENDING').length,
        observed: observations.filter(o => o.classification === 'OBSERVED').length,
        matched: observations.filter(o => o.classification === 'MATCHED').length,
        verified: observations.filter(o => o.classification === 'VERIFIED').length
      },
      timestamp: new Date().toISOString()
    };
  }
}
